import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "fs";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIELDS_PATH = path.join(__dirname, "fields.js");

// Store mutável — começa vazio, preenchido pelo sync_fields ou pelo arquivo existente
let DEAL_CUSTOM_FIELDS = {};
let KEY_TO_NAME = {};
let KEY_TO_OPTIONS = {};

function rebuildReverseMaps() {
  KEY_TO_NAME = {};
  KEY_TO_OPTIONS = {};
  for (const [name, field] of Object.entries(DEAL_CUSTOM_FIELDS)) {
    KEY_TO_NAME[field.key] = name;
    if (field.options) {
      const idToLabel = {};
      for (const [label, id] of Object.entries(field.options)) {
        idToLabel[id] = label;
      }
      KEY_TO_OPTIONS[field.key] = idToLabel;
    }
  }
}

// Tenta carregar fields.js existente na inicialização
try {
  const fieldsUrl = new URL("./fields.js", import.meta.url).href;
  const mod = await import(fieldsUrl);
  DEAL_CUSTOM_FIELDS = mod.DEAL_CUSTOM_FIELDS || {};
  rebuildReverseMaps();
} catch {
  // Sem fields.js — funciona sem campos personalizados até rodar sync_fields
}

const API_KEY = process.env.PIPEDRIVE_API_KEY;
const BASE_URL = "https://api.pipedrive.com/v1";

// ─── HELPERS ──────────────────────────────────────────────────────────────────

const RETRYABLE_STATUSES = [408, 429, 500, 502, 503, 504];

function friendlyError(status, defaultMsg) {
  const messages = {
    401: "Token de API inválido. Verifique a variável PIPEDRIVE_API_KEY.",
    403: "Sem permissão para acessar este recurso no Pipedrive.",
    404: "Recurso não encontrado no Pipedrive. Pode ter sido deletado.",
    429: "Limite de requisições atingido. Tente novamente em alguns segundos.",
    500: "Erro interno do servidor Pipedrive. Tente novamente.",
    502: "Pipedrive temporariamente indisponível. Tente novamente.",
    503: "Pipedrive em manutenção. Tente novamente em instantes.",
  };
  return messages[status] || defaultMsg || `Erro ${status} na API do Pipedrive.`;
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pipedriveRequest(path, options = {}, retries = 3) {
  // PROTOCOLO DE SEGURANÇA: bloquear qualquer operação DELETE
  const method = (options.method || "GET").toUpperCase();
  if (method === "DELETE") {
    throw new Error("BLOQUEADO: Operações de exclusão (DELETE) não são permitidas. Protocolo de segurança ativo.");
  }

  const separator = path.includes("?") ? "&" : "?";
  const url = `${BASE_URL}${path}${separator}api_token=${API_KEY}`;

  for (let attempt = 1; attempt <= retries; attempt++) {
    const response = await fetch(url, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });

    if (!response.ok && RETRYABLE_STATUSES.includes(response.status) && attempt < retries) {
      const delay = Math.min(1000 * Math.pow(2, attempt - 1), 8000);
      await sleep(delay);
      continue;
    }

    if (!response.ok) {
      throw new Error(friendlyError(response.status));
    }

    const data = await response.json();
    if (!data.success) {
      throw new Error(data.error || "Erro desconhecido na API do Pipedrive.");
    }
    return data;
  }
}

// Converte campos personalizados de nome legível para o formato da API
function resolveCustomFields(fields) {
  const body = {};
  const errors = [];
  for (const [name, value] of Object.entries(fields)) {
    const field = DEAL_CUSTOM_FIELDS[name];
    if (!field) { errors.push(`Campo "${name}" não existe.`); continue; }
    if (field.type === "enum") {
      const optionId = field.options?.[value];
      if (optionId === undefined) {
        errors.push(`"${name}": valor "${value}" inválido. Opções: ${Object.keys(field.options).join(", ")}`);
        continue;
      }
      body[field.key] = optionId;
    } else if (field.type === "set") {
      const values = Array.isArray(value) ? value : value.split(",").map((v) => v.trim());
      const ids = [];
      for (const v of values) {
        const optionId = field.options?.[v];
        if (optionId === undefined) {
          errors.push(`"${name}": valor "${v}" inválido. Opções: ${Object.keys(field.options).join(", ")}`);
        } else {
          ids.push(optionId);
        }
      }
      if (ids.length > 0) body[field.key] = ids.join(",");
    } else if (field.type === "double") {
      body[field.key] = Number(value);
    } else if (field.type === "user") {
      body[field.key] = Number(value);
    } else {
      body[field.key] = String(value);
    }
  }
  return { body, errors };
}

// Traduz campos personalizados de um deal para nomes legíveis
function translateDealFields(deal) {
  const result = {
    id: deal.id,
    titulo: deal.title,
    valor: deal.value,
    moeda: deal.currency,
    status: deal.status,
    etapa_id: deal.stage_id,
    pipeline_id: deal.pipeline_id,
    contato: deal.person_name,
    empresa: deal.org_name,
    responsavel: deal.owner_name,
    criado_em: deal.add_time,
    atualizado_em: deal.update_time,
  };
  for (const [apiKey, fieldName] of Object.entries(KEY_TO_NAME)) {
    const rawValue = deal[apiKey];
    if (rawValue === null || rawValue === undefined || rawValue === "") continue;
    const optionsMap = KEY_TO_OPTIONS[apiKey];
    if (optionsMap) {
      if (String(rawValue).includes(",")) {
        result[fieldName] = String(rawValue).split(",").map((id) => optionsMap[id.trim()] || id).join(", ");
      } else {
        result[fieldName] = optionsMap[rawValue] || rawValue;
      }
    } else {
      result[fieldName] = rawValue;
    }
  }
  return result;
}

const server = new McpServer({
  name: "pipedrive-mcp",
  version: "5.0.0",
});

// ─── NEGÓCIOS ────────────────────────────────────────────────────────────────

server.tool(
  "list_deals",
  "Lista negócios do Pipedrive. Pode filtrar por status e pipeline. Suporta paginação via start/limit e busca automática de todos os registros via buscar_todos.",
  {
    status: z.enum(["open", "won", "lost", "all"]).optional().default("open").describe("Status dos negócios"),
    pipeline_id: z.number().optional().describe("ID do pipeline para filtrar"),
    stage_id: z.number().optional().describe("ID da etapa para filtrar"),
    user_id: z.number().optional().describe("ID do responsável para filtrar. Use list_users para ver IDs."),
    limit: z.number().optional().default(100).describe("Quantidade máxima de resultados por página (máx 500)"),
    start: z.number().optional().default(0).describe("Offset para paginação. Use 0 para primeira página, ou o valor de proximo_inicio da resposta anterior."),
    buscar_todos: z.boolean().optional().default(false).describe("Se true, busca TODAS as páginas automaticamente (máx 5000 registros). Ignora start/limit."),
  },
  async ({ status, pipeline_id, stage_id, user_id, limit, start, buscar_todos }) => {
    const mapDeal = (d) => ({
      id: d.id,
      titulo: d.title,
      valor: d.value,
      moeda: d.currency,
      status: d.status,
      etapa: d.stage_id,
      pipeline: d.pipeline_id,
      contato: d.person_name,
      empresa: d.org_name,
      responsavel: d.owner_name,
      criado_em: d.add_time,
      atualizado_em: d.update_time,
    });

    const buildPath = (pageLimit, pageStart) => {
      let path = `/deals?status=${status}&limit=${pageLimit}&start=${pageStart}`;
      if (pipeline_id) path += `&pipeline_id=${pipeline_id}`;
      if (stage_id) path += `&stage_id=${stage_id}`;
      if (user_id) path += `&user_id=${user_id}`;
      return path;
    };

    if (buscar_todos) {
      let allDeals = [];
      let currentStart = 0;
      const pageSize = 500;
      const MAX_RECORDS = 5000;

      while (allDeals.length < MAX_RECORDS) {
        const data = await pipedriveRequest(buildPath(pageSize, currentStart));
        const pageDeals = (data.data || []).map(mapDeal);
        allDeals = allDeals.concat(pageDeals);

        const pagination = data.additional_data?.pagination;
        if (!pagination?.more_items_in_collection) break;
        currentStart = pagination.next_start;
      }

      const result = {
        dados: allDeals,
        paginacao: {
          total: allDeals.length,
          todas_paginas: true,
          limite_seguranca: MAX_RECORDS,
          truncado: allDeals.length >= MAX_RECORDS,
        },
      };
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }

    const effectiveLimit = Math.min(limit, 500);
    const data = await pipedriveRequest(buildPath(effectiveLimit, start));
    const deals = (data.data || []).map(mapDeal);
    const pagination = data.additional_data?.pagination || {};

    const result = {
      dados: deals,
      paginacao: {
        inicio: pagination.start || start,
        limite: pagination.limit || effectiveLimit,
        total_nesta_pagina: deals.length,
        mais_itens: pagination.more_items_in_collection || false,
        proximo_inicio: pagination.next_start || null,
      },
    };
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "search_deals",
  "Busca negócios por termo (título, contato, empresa).",
  {
    term: z.string().describe("Termo de busca"),
    limit: z.number().optional().default(10).describe("Quantidade máxima de resultados"),
  },
  async ({ term, limit }) => {
    const data = await pipedriveRequest(`/deals/search?term=${encodeURIComponent(term)}&limit=${limit}`);
    const deals = (data.data?.items || []).map((i) => ({
      id: i.item.id,
      titulo: i.item.title,
      valor: i.item.value,
      status: i.item.status,
      contato: i.item.person?.name,
      empresa: i.item.organization?.name,
    }));
    return { content: [{ type: "text", text: JSON.stringify(deals, null, 2) }] };
  }
);

server.tool(
  "get_deal",
  "Retorna detalhes completos de um negócio pelo ID, incluindo campos personalizados com nomes legíveis.",
  { deal_id: z.number().describe("ID do negócio") },
  async ({ deal_id }) => {
    const data = await pipedriveRequest(`/deals/${deal_id}`);
    const translated = translateDealFields(data.data);
    return { content: [{ type: "text", text: JSON.stringify(translated, null, 2) }] };
  }
);

server.tool(
  "create_deal",
  "Cria um novo negócio no Pipedrive. Aceita campos personalizados via custom_fields.",
  {
    title: z.string().describe("Título do negócio"),
    value: z.number().optional().describe("Valor do negócio"),
    currency: z.string().optional().default("BRL").describe("Moeda (padrão BRL)"),
    person_id: z.number().optional().describe("ID do contato"),
    org_id: z.number().optional().describe("ID da organização"),
    pipeline_id: z.number().optional().describe("ID do pipeline"),
    stage_id: z.number().optional().describe("ID da etapa"),
    custom_fields: z.string().optional().describe('JSON com campos personalizados. Ex: {"Segmento": "Jurídico", "Origem da Oportunidade": "INDIC | Geral"}'),
  },
  async ({ title, value, currency, person_id, org_id, pipeline_id, stage_id, custom_fields }) => {
    const body = { title, currency };
    if (value !== undefined) body.value = value;
    if (person_id) body.person_id = person_id;
    if (org_id) body.org_id = org_id;
    if (pipeline_id) body.pipeline_id = pipeline_id;
    if (stage_id) body.stage_id = stage_id;
    let warnings = [];
    if (custom_fields) {
      try {
        const parsed = JSON.parse(custom_fields);
        const { body: customBody, errors } = resolveCustomFields(parsed);
        Object.assign(body, customBody);
        warnings = errors;
      } catch {
        return { content: [{ type: "text", text: "Erro: custom_fields deve ser um JSON válido." }] };
      }
    }
    const data = await pipedriveRequest("/deals", {
      method: "POST",
      body: JSON.stringify(body),
    });
    let msg = `Negócio criado! ID: ${data.data.id} — "${data.data.title}"`;
    if (warnings.length > 0) msg += `\n\nAvisos:\n${warnings.join("\n")}`;
    return { content: [{ type: "text", text: msg }] };
  }
);

server.tool(
  "update_deal",
  "Atualiza um negócio (status, etapa, pipeline, valor, etc.).",
  {
    deal_id: z.number().describe("ID do negócio"),
    title: z.string().optional().describe("Novo título"),
    value: z.number().optional().describe("Novo valor"),
    stage_id: z.number().optional().describe("Nova etapa"),
    pipeline_id: z.number().optional().describe("Novo pipeline (mover entre pipelines)"),
    status: z.enum(["open", "won", "lost"]).optional().describe("Novo status"),
    lost_reason: z.string().optional().describe("Motivo da perda (usado quando status=lost)"),
  },
  async ({ deal_id, title, value, stage_id, pipeline_id, status, lost_reason }) => {
    const body = {};
    if (title) body.title = title;
    if (value !== undefined) body.value = value;
    if (stage_id) body.stage_id = stage_id;
    if (pipeline_id) body.pipeline_id = pipeline_id;
    if (status) body.status = status;
    if (lost_reason) body.lost_reason = lost_reason;
    await pipedriveRequest(`/deals/${deal_id}`, {
      method: "PUT",
      body: JSON.stringify(body),
    });
    return { content: [{ type: "text", text: `Negócio ${deal_id} atualizado com sucesso.` }] };
  }
);

server.tool(
  "get_deal_summary",
  "Retorna um resumo estatístico dos negócios (valores totais e contagens por status).",
  {
    status: z.enum(["open", "won", "lost", "all"]).optional().default("open").describe("Status dos negócios"),
    filter_id: z.number().optional().describe("ID de um filtro salvo no Pipedrive"),
    pipeline_id: z.number().optional().describe("ID do pipeline"),
    stage_id: z.number().optional().describe("ID da etapa"),
    user_id: z.number().optional().describe("ID do responsável"),
  },
  async ({ status, filter_id, pipeline_id, stage_id, user_id }) => {
    let path = `/deals/summary?status=${status}`;
    if (filter_id) path += `&filter_id=${filter_id}`;
    if (pipeline_id) path += `&pipeline_id=${pipeline_id}`;
    if (stage_id) path += `&stage_id=${stage_id}`;
    if (user_id) path += `&user_id=${user_id}`;
    const data = await pipedriveRequest(path);
    const summary = {
      total_valor: data.data?.total_value,
      total_formatado: data.data?.total_currency_converted_value_formatted,
      quantidade: data.data?.total_count,
      valor_medio_ponderado: data.data?.total_weighted_value,
      por_moeda: data.data?.values_total,
    };
    return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
  }
);

server.tool(
  "list_deal_history",
  "Lista o histórico de alterações de um negócio (mudanças de campos, etapa, status).",
  {
    deal_id: z.number().describe("ID do negócio"),
    limit: z.number().optional().default(100).describe("Quantidade máxima de resultados (máx 500)"),
    start: z.number().optional().default(0).describe("Offset para paginação"),
  },
  async ({ deal_id, limit, start }) => {
    const effectiveLimit = Math.min(limit, 500);
    const data = await pipedriveRequest(`/deals/${deal_id}/flow?limit=${effectiveLimit}&start=${start}`);
    const history = (data.data || []).map((item) => ({
      acao: item.object,
      timestamp: item.timestamp,
      dados: item.data,
    }));
    const pagination = data.additional_data?.pagination || {};
    const result = {
      dados: history,
      paginacao: {
        inicio: pagination.start || start,
        total_nesta_pagina: history.length,
        mais_itens: pagination.more_items_in_collection || false,
        proximo_inicio: pagination.next_start || null,
      },
    };
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// ─── NOTAS ────────────────────────────────────────────────────────────────────

server.tool(
  "create_note",
  "Cria uma nota em um negócio, contato ou organização. O conteúdo suporta HTML.",
  {
    content: z.string().describe("Conteúdo da nota (suporta HTML)"),
    deal_id: z.number().optional().describe("ID do negócio relacionado"),
    person_id: z.number().optional().describe("ID do contato relacionado"),
    org_id: z.number().optional().describe("ID da organização relacionada"),
  },
  async ({ content, deal_id, person_id, org_id }) => {
    const body = { content };
    if (deal_id) body.deal_id = deal_id;
    if (person_id) body.person_id = person_id;
    if (org_id) body.org_id = org_id;
    const data = await pipedriveRequest("/notes", {
      method: "POST",
      body: JSON.stringify(body),
    });
    return { content: [{ type: "text", text: `Nota criada! ID: ${data.data.id}` }] };
  }
);

server.tool(
  "list_deal_notes",
  "Lista as notas de um negócio.",
  {
    deal_id: z.number().describe("ID do negócio"),
    limit: z.number().optional().default(100).describe("Quantidade máxima de resultados (máx 500)"),
    start: z.number().optional().default(0).describe("Offset para paginação"),
  },
  async ({ deal_id, limit, start }) => {
    const effectiveLimit = Math.min(limit, 500);
    const data = await pipedriveRequest(`/notes?deal_id=${deal_id}&limit=${effectiveLimit}&start=${start}&sort=add_time DESC`);
    const notes = (data.data || []).map((n) => ({
      id: n.id,
      conteudo: n.content,
      criado_em: n.add_time,
      atualizado_em: n.update_time,
      criado_por: n.user?.name,
    }));
    const pagination = data.additional_data?.pagination || {};
    const result = {
      dados: notes,
      paginacao: {
        inicio: pagination.start || start,
        total_nesta_pagina: notes.length,
        mais_itens: pagination.more_items_in_collection || false,
        proximo_inicio: pagination.next_start || null,
      },
    };
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// ─── CONTATOS (PESSOAS) ───────────────────────────────────────────────────────

server.tool(
  "list_persons",
  "Lista contatos do Pipedrive.",
  {
    limit: z.number().optional().default(100).describe("Quantidade máxima de resultados (máx 500)"),
    start: z.number().optional().default(0).describe("Offset para paginação"),
  },
  async ({ limit, start }) => {
    const effectiveLimit = Math.min(limit, 500);
    const data = await pipedriveRequest(`/persons?limit=${effectiveLimit}&start=${start}`);
    const persons = (data.data || []).map((p) => ({
      id: p.id,
      nome: p.name,
      email: p.email?.[0]?.value,
      telefone: p.phone?.[0]?.value,
      empresa: p.org_name,
      negocios_abertos: p.open_deals_count,
    }));
    const pagination = data.additional_data?.pagination || {};
    const result = {
      dados: persons,
      paginacao: {
        inicio: pagination.start || start,
        total_nesta_pagina: persons.length,
        mais_itens: pagination.more_items_in_collection || false,
        proximo_inicio: pagination.next_start || null,
      },
    };
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "search_persons",
  "Busca contatos por nome, email ou telefone.",
  {
    term: z.string().describe("Termo de busca"),
    limit: z.number().optional().default(10).describe("Quantidade máxima de resultados"),
  },
  async ({ term, limit }) => {
    const data = await pipedriveRequest(`/persons/search?term=${encodeURIComponent(term)}&limit=${limit}`);
    const persons = (data.data?.items || []).map((i) => ({
      id: i.item.id,
      nome: i.item.name,
      email: i.item.emails?.[0],
      telefone: i.item.phones?.[0],
      empresa: i.item.organization?.name,
    }));
    return { content: [{ type: "text", text: JSON.stringify(persons, null, 2) }] };
  }
);

server.tool(
  "get_person",
  "Retorna detalhes completos de um contato pelo ID.",
  { person_id: z.number().describe("ID do contato") },
  async ({ person_id }) => {
    const data = await pipedriveRequest(`/persons/${person_id}`);
    return { content: [{ type: "text", text: JSON.stringify(data.data, null, 2) }] };
  }
);

server.tool(
  "create_person",
  "Cria um novo contato no Pipedrive.",
  {
    name: z.string().describe("Nome do contato"),
    email: z.string().optional().describe("E-mail do contato"),
    phone: z.string().optional().describe("Telefone do contato"),
    org_id: z.number().optional().describe("ID da organização"),
  },
  async ({ name, email, phone, org_id }) => {
    const body = { name };
    if (email) body.email = [{ value: email, primary: true }];
    if (phone) body.phone = [{ value: phone, primary: true }];
    if (org_id) body.org_id = org_id;
    const data = await pipedriveRequest("/persons", {
      method: "POST",
      body: JSON.stringify(body),
    });
    return { content: [{ type: "text", text: `Contato criado! ID: ${data.data.id} — "${data.data.name}"` }] };
  }
);

server.tool(
  "update_person",
  "Atualiza um contato (nome, email, telefone, organização).",
  {
    person_id: z.number().describe("ID do contato"),
    name: z.string().optional().describe("Novo nome"),
    email: z.string().optional().describe("Novo e-mail"),
    phone: z.string().optional().describe("Novo telefone"),
    org_id: z.number().optional().describe("ID da nova organização"),
  },
  async ({ person_id, name, email, phone, org_id }) => {
    const body = {};
    if (name) body.name = name;
    if (org_id) body.org_id = org_id;
    // Para email e phone: buscar dados atuais e ADICIONAR em vez de substituir
    if (email || phone) {
      const current = await pipedriveRequest(`/persons/${person_id}`);
      const person = current.data;
      if (email) {
        const existingEmails = person.email || [];
        const alreadyExists = existingEmails.some((e) => e.value === email);
        if (alreadyExists) {
          body.email = existingEmails;
        } else {
          body.email = [...existingEmails, { value: email, primary: existingEmails.length === 0 }];
        }
      }
      if (phone) {
        const existingPhones = person.phone || [];
        const alreadyExists = existingPhones.some((p) => p.value === phone);
        if (alreadyExists) {
          body.phone = existingPhones;
        } else {
          body.phone = [...existingPhones, { value: phone, primary: existingPhones.length === 0 }];
        }
      }
    }
    await pipedriveRequest(`/persons/${person_id}`, {
      method: "PUT",
      body: JSON.stringify(body),
    });
    return { content: [{ type: "text", text: `Contato ${person_id} atualizado com sucesso.` }] };
  }
);

// ─── ORGANIZAÇÕES ─────────────────────────────────────────────────────────────

server.tool(
  "search_organizations",
  "Busca organizações/empresas no Pipedrive.",
  {
    term: z.string().describe("Termo de busca"),
    limit: z.number().optional().default(10).describe("Quantidade máxima de resultados"),
  },
  async ({ term, limit }) => {
    const data = await pipedriveRequest(`/organizations/search?term=${encodeURIComponent(term)}&limit=${limit}`);
    const orgs = (data.data?.items || []).map((i) => ({
      id: i.item.id,
      nome: i.item.name,
      endereco: i.item.address,
      negocios_abertos: i.item.open_deals_count,
    }));
    return { content: [{ type: "text", text: JSON.stringify(orgs, null, 2) }] };
  }
);

server.tool(
  "get_organization",
  "Retorna detalhes completos de uma organização pelo ID.",
  { org_id: z.number().describe("ID da organização") },
  async ({ org_id }) => {
    const data = await pipedriveRequest(`/organizations/${org_id}`);
    const org = data.data;
    return {
      content: [{ type: "text", text: JSON.stringify({
        id: org.id,
        nome: org.name,
        endereco: org.address,
        negocios_abertos: org.open_deals_count,
        negocios_ganhos: org.won_deals_count,
        negocios_perdidos: org.lost_deals_count,
        contatos: org.people_count,
        responsavel: org.owner_name,
        criado_em: org.add_time,
      }, null, 2) }],
    };
  }
);

server.tool(
  "create_organization",
  "Cria uma nova organização/empresa no Pipedrive.",
  {
    name: z.string().describe("Nome da organização"),
    address: z.string().optional().describe("Endereço da organização"),
    owner_id: z.number().optional().describe("ID do usuário responsável"),
  },
  async ({ name, address, owner_id }) => {
    const body = { name };
    if (address) body.address = address;
    if (owner_id) body.owner_id = owner_id;
    const data = await pipedriveRequest("/organizations", {
      method: "POST",
      body: JSON.stringify(body),
    });
    return { content: [{ type: "text", text: `Organização criada! ID: ${data.data.id} — "${data.data.name}"` }] };
  }
);

// ─── ATIVIDADES ───────────────────────────────────────────────────────────────

server.tool(
  "list_activities",
  "Lista atividades do Pipedrive. Pode filtrar por usuário, tipo, período, negócio e status. Inclui indicador 'atrasada' para atividades vencidas.",
  {
    done: z.boolean().optional().default(false).describe("Listar atividades concluídas (false = pendentes)"),
    limit: z.number().optional().default(100).describe("Quantidade máxima de resultados (máx 500)"),
    start: z.number().optional().default(0).describe("Offset para paginação"),
    user_id: z.number().optional().describe("Filtrar por usuário (ID). Use list_users para ver IDs disponíveis."),
    type: z.enum(["whatsapp", "call", "instagram", "linkedin", "email", "task", "encontro_presencial", "diagnostico", "apresentacao", "meeting", "deadline"]).optional().describe("Filtrar por tipo de atividade"),
    start_date: z.string().optional().describe("Data inicial do filtro (YYYY-MM-DD)"),
    end_date: z.string().optional().describe("Data final do filtro (YYYY-MM-DD)"),
    deal_id: z.number().optional().describe("Filtrar por negócio (ID)"),
  },
  async ({ done, limit, start, user_id, type, start_date, end_date, deal_id }) => {
    const effectiveLimit = Math.min(limit, 500);
    let path = `/activities?done=${done ? 1 : 0}&limit=${effectiveLimit}&start=${start}`;
    if (user_id) path += `&user_id=${user_id}`;
    if (type) path += `&type=${type}`;
    if (start_date) path += `&start_date=${start_date}`;
    if (end_date) path += `&end_date=${end_date}`;
    if (deal_id) path += `&deal_id=${deal_id}`;
    const data = await pipedriveRequest(path);
    const today = new Date().toISOString().split("T")[0];
    const activities = (data.data || []).map((a) => ({
      id: a.id,
      tipo: a.type,
      assunto: a.subject,
      data: a.due_date,
      hora: a.due_time,
      concluida: a.done,
      atrasada: !a.done && a.due_date ? a.due_date < today : false,
      negocio_id: a.deal_id,
      negocio: a.deal_title,
      contato: a.person_name,
      responsavel: a.owner_name,
    }));
    const pagination = data.additional_data?.pagination || {};
    const result = {
      dados: activities,
      paginacao: {
        inicio: pagination.start || start,
        total_nesta_pagina: activities.length,
        mais_itens: pagination.more_items_in_collection || false,
        proximo_inicio: pagination.next_start || null,
      },
    };
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "list_activity_types",
  "Lista todos os tipos de atividade disponíveis (nativos e personalizados).",
  {},
  async () => {
    const data = await pipedriveRequest("/activityTypes");
    const types = (data.data || []).map((t) => ({
      key: t.key_string,
      nome: t.name,
      personalizado: !!t.is_custom_flag,
      ativo: !!t.active_flag,
    }));
    return { content: [{ type: "text", text: JSON.stringify(types, null, 2) }] };
  }
);

server.tool(
  "create_activity",
  "Cria uma nova atividade/tarefa no Pipedrive. Tipos: whatsapp, call (Chamada), instagram, linkedin, email, task (Tarefa), encontro_presencial, diagnostico (Reunião inicial), apresentacao (Reunião de Apresentação), meeting (NO-SHOW), deadline (Prazo).",
  {
    subject: z.string().describe("Assunto da atividade"),
    type: z.enum(["whatsapp", "call", "instagram", "linkedin", "email", "task", "encontro_presencial", "diagnostico", "apresentacao", "meeting", "deadline"]).describe("Tipo da atividade"),
    due_date: z.string().describe("Data de vencimento (YYYY-MM-DD)"),
    due_time: z.string().optional().describe("Hora de vencimento (HH:MM)"),
    deal_id: z.number().optional().describe("ID do negócio relacionado"),
    person_id: z.number().optional().describe("ID do contato relacionado"),
    user_id: z.number().optional().describe("ID do usuário responsável (use list_users para ver IDs)"),
    note: z.string().optional().describe("Nota/observação"),
  },
  async ({ subject, type, due_date, due_time, deal_id, person_id, user_id, note }) => {
    const body = { subject, type, due_date };
    if (due_time) body.due_time = due_time;
    if (deal_id) body.deal_id = deal_id;
    if (person_id) body.person_id = person_id;
    if (user_id) body.user_id = user_id;
    if (note) body.note = note;
    const data = await pipedriveRequest("/activities", {
      method: "POST",
      body: JSON.stringify(body),
    });
    return { content: [{ type: "text", text: `Atividade criada! ID: ${data.data.id} — "${data.data.subject}"` }] };
  }
);

server.tool(
  "update_activity",
  "Atualiza uma atividade: marcar como feita, reagendar, mudar responsável ou tipo.",
  {
    activity_id: z.number().describe("ID da atividade"),
    done: z.boolean().optional().describe("Marcar como concluída (true) ou pendente (false)"),
    subject: z.string().optional().describe("Novo assunto"),
    type: z.enum(["whatsapp", "call", "instagram", "linkedin", "email", "task", "encontro_presencial", "diagnostico", "apresentacao", "meeting", "deadline"]).optional().describe("Novo tipo"),
    due_date: z.string().optional().describe("Nova data (YYYY-MM-DD)"),
    due_time: z.string().optional().describe("Nova hora (HH:MM)"),
    user_id: z.number().optional().describe("Novo responsável (ID do usuário)"),
    note: z.string().optional().describe("Nova nota/observação"),
  },
  async ({ activity_id, done, subject, type, due_date, due_time, user_id, note }) => {
    const body = {};
    if (done !== undefined) body.done = done ? 1 : 0;
    if (subject) body.subject = subject;
    if (type) body.type = type;
    if (due_date) body.due_date = due_date;
    if (due_time) body.due_time = due_time;
    if (user_id) body.user_id = user_id;
    if (note) body.note = note;
    await pipedriveRequest(`/activities/${activity_id}`, {
      method: "PUT",
      body: JSON.stringify(body),
    });
    const actions = [];
    if (done !== undefined) actions.push(done ? "concluída" : "reaberta");
    if (due_date) actions.push(`reagendada para ${due_date}`);
    if (user_id) actions.push("responsável alterado");
    if (type) actions.push(`tipo alterado para ${type}`);
    if (subject) actions.push("assunto alterado");
    return { content: [{ type: "text", text: `Atividade ${activity_id} ${actions.join(", ") || "atualizada"}.` }] };
  }
);

// ─── PIPELINE ─────────────────────────────────────────────────────────────────

server.tool(
  "list_pipelines",
  "Lista todos os pipelines do Pipedrive.",
  {},
  async () => {
    const data = await pipedriveRequest("/pipelines");
    const pipelines = (data.data || []).map((p) => ({
      id: p.id,
      nome: p.name,
      ativo: p.active,
    }));
    return { content: [{ type: "text", text: JSON.stringify(pipelines, null, 2) }] };
  }
);

server.tool(
  "list_stages",
  "Lista as etapas de um pipeline.",
  { pipeline_id: z.number().describe("ID do pipeline") },
  async ({ pipeline_id }) => {
    const data = await pipedriveRequest(`/stages?pipeline_id=${pipeline_id}`);
    const stages = (data.data || []).map((s) => ({
      id: s.id,
      nome: s.name,
      ordem: s.order_nr,
      pipeline_id: s.pipeline_id,
    }));
    return { content: [{ type: "text", text: JSON.stringify(stages, null, 2) }] };
  }
);

// ─── USUÁRIOS ─────────────────────────────────────────────────────────────────

server.tool(
  "list_users",
  "Lista os usuários/membros da equipe do Pipedrive.",
  {},
  async () => {
    const data = await pipedriveRequest("/users");
    const users = (data.data || []).map((u) => ({
      id: u.id,
      nome: u.name,
      email: u.email,
      ativo: u.active_flag,
    }));
    return { content: [{ type: "text", text: JSON.stringify(users, null, 2) }] };
  }
);

// ─── PRODUTOS ─────────────────────────────────────────────────────────────────

server.tool(
  "list_products",
  "Lista os produtos disponíveis no Pipedrive.",
  {
    limit: z.number().optional().default(100).describe("Quantidade máxima de resultados (máx 500)"),
    start: z.number().optional().default(0).describe("Offset para paginação"),
  },
  async ({ limit, start }) => {
    const effectiveLimit = Math.min(limit, 500);
    const data = await pipedriveRequest(`/products?limit=${effectiveLimit}&start=${start}`);
    const products = (data.data || []).map((p) => ({
      id: p.id,
      nome: p.name,
      codigo: p.code,
      preco: p.prices?.[0]?.price,
      moeda: p.prices?.[0]?.currency,
      ativo: p.active_flag,
    }));
    const pagination = data.additional_data?.pagination || {};
    const result = {
      dados: products,
      paginacao: {
        inicio: pagination.start || start,
        total_nesta_pagina: products.length,
        mais_itens: pagination.more_items_in_collection || false,
        proximo_inicio: pagination.next_start || null,
      },
    };
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "add_product_to_deal",
  "Vincula um produto a um negócio.",
  {
    deal_id: z.number().describe("ID do negócio"),
    product_id: z.number().describe("ID do produto"),
    item_price: z.number().describe("Preço unitário do produto neste negócio"),
    quantity: z.number().optional().default(1).describe("Quantidade"),
    discount_percentage: z.number().optional().default(0).describe("Percentual de desconto"),
  },
  async ({ deal_id, product_id, item_price, quantity, discount_percentage }) => {
    const body = { product_id, item_price, quantity };
    if (discount_percentage > 0) body.discount_percentage = discount_percentage;
    await pipedriveRequest(`/deals/${deal_id}/products`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    return { content: [{ type: "text", text: `Produto ${product_id} vinculado ao negócio ${deal_id}.` }] };
  }
);

// ─── CAMPOS PERSONALIZADOS ────────────────────────────────────────────────────

server.tool(
  "list_deal_fields",
  "Lista todos os campos personalizados disponíveis para negócios, incluindo as opções válidas para campos enum/set.",
  {},
  async () => {
    const fields = Object.entries(DEAL_CUSTOM_FIELDS).map(([name, f]) => {
      const entry = { nome: name, tipo: f.type };
      if (f.options) entry.opcoes = Object.keys(f.options);
      return entry;
    });
    return { content: [{ type: "text", text: JSON.stringify(fields, null, 2) }] };
  }
);

server.tool(
  "update_deal_fields",
  "Atualiza campos personalizados de um negócio. Passe um JSON com o nome do campo e o valor. Para campos enum, use o texto exato da opção. Para set (múltipla escolha), separe por vírgula. Use list_deal_fields para ver campos e opções disponíveis. IMPORTANTE: Se um campo já tiver valor preenchido, a ferramenta NÃO vai sobrescrever — vai retornar os conflitos para você perguntar ao usuário. Use force=true SOMENTE após confirmação explícita do usuário.",
  {
    deal_id: z.number().describe("ID do negócio"),
    custom_fields: z.string().describe('JSON com os campos a atualizar. Ex: {"Segmento": "Jurídico", "CRM atual": "Pipedrive", "Dores": "Falta de organização"}'),
    force: z.boolean().optional().default(false).describe("Se true, sobrescreve campos que já têm valor. SOMENTE usar após confirmação explícita do usuário."),
  },
  async ({ deal_id, custom_fields, force }) => {
    let parsed;
    try {
      parsed = JSON.parse(custom_fields);
    } catch {
      return { content: [{ type: "text", text: "Erro: custom_fields deve ser um JSON válido." }] };
    }
    const { body, errors } = resolveCustomFields(parsed);
    if (errors.length > 0 && Object.keys(body).length === 0) {
      return { content: [{ type: "text", text: `Erros de validação:\n${errors.join("\n")}` }] };
    }
    // Proteção: buscar deal atual e verificar campos que já têm valor
    const currentDeal = await pipedriveRequest(`/deals/${deal_id}`).catch(() => null);
    const dealData = currentDeal?.data || {};
    // Mapear API key → nome legível
    const apiKeyToName = {};
    for (const [name, value] of Object.entries(parsed)) {
      const resolved = resolveCustomFields({ [name]: value });
      for (const k of Object.keys(resolved.body)) {
        apiKeyToName[k] = name;
      }
    }
    const safeBody = {};
    const conflicts = [];
    for (const [key, value] of Object.entries(body)) {
      const current = dealData[key];
      const isEmpty = current === null || current === undefined || current === "" || current === 0;
      if (isEmpty || force) {
        safeBody[key] = value;
      } else {
        const fieldName = apiKeyToName[key] || key;
        conflicts.push({ field: fieldName, current_value: current, new_value: value });
      }
    }
    // Se há conflitos e não é force, retornar sem atualizar os conflitantes
    if (conflicts.length > 0 && !force) {
      let msg = "";
      if (Object.keys(safeBody).length > 0) {
        await pipedriveRequest(`/deals/${deal_id}`, {
          method: "PUT",
          body: JSON.stringify(safeBody),
        });
        msg += `✅ Campos vazios atualizados: ${Object.keys(safeBody).length}\n\n`;
      }
      msg += `⚠️ CONFLITO — Os seguintes campos JÁ TÊM VALOR preenchido:\n`;
      for (const c of conflicts) {
        msg += `\n• "${c.field}"\n  Valor atual: "${c.current_value}"\n  Novo valor solicitado: "${c.new_value}"`;
      }
      msg += `\n\n→ Pergunte ao usuário se deseja sobrescrever. Se sim, chame novamente com force=true.`;
      if (errors.length > 0) msg += `\n\nAvisos:\n${errors.join("\n")}`;
      return { content: [{ type: "text", text: msg }] };
    }
    // Atualizar tudo (force=true ou todos vazios)
    if (Object.keys(safeBody).length > 0) {
      await pipedriveRequest(`/deals/${deal_id}`, {
        method: "PUT",
        body: JSON.stringify(safeBody),
      });
    }
    let msg = `Negócio ${deal_id} atualizado! Campos alterados: ${Object.keys(parsed).join(", ")}`;
    if (force && conflicts.length > 0) {
      msg += ` (${conflicts.length} campo(s) sobrescrito(s) com confirmação do usuário)`;
    }
    if (errors.length > 0) msg += `\n\nAvisos:\n${errors.join("\n")}`;
    return { content: [{ type: "text", text: msg }] };
  }
);

// ─── SINCRONIZAÇÃO DE CAMPOS ─────────────────────────────────────────────────

server.tool(
  "sync_fields",
  "Sincroniza campos personalizados do Pipedrive. Execute após a primeira instalação ou quando adicionar/alterar campos no Pipedrive. Gera o arquivo fields.js com o mapeamento da sua conta.",
  {},
  async () => {
    // 1. Buscar todos os dealFields da API
    const data = await pipedriveRequest("/dealFields?limit=500");
    const allFields = data.data || [];

    // 2. Filtrar campos customizados (key é hash hex de 40 chars)
    const customFields = allFields.filter((f) => /^[a-f0-9]{40}$/.test(f.key));

    if (customFields.length === 0) {
      return { content: [{ type: "text", text: "Nenhum campo personalizado encontrado nesta conta do Pipedrive." }] };
    }

    // 3. Montar DEAL_CUSTOM_FIELDS
    const mapping = {};
    let enumCount = 0;
    let setText = 0;
    let textCount = 0;

    for (const field of customFields) {
      const entry = { key: field.key, type: field.field_type };

      if ((field.field_type === "enum" || field.field_type === "set") && field.options) {
        entry.options = {};
        for (const opt of field.options) {
          entry.options[opt.label] = opt.id;
        }
        if (field.field_type === "enum") enumCount++;
        else setText++;
      } else {
        textCount++;
      }

      mapping[field.name] = entry;
    }

    // 4. Salvar em fields.js
    const lines = [
      "// Mapeamento dos campos personalizados de negócios do Pipedrive",
      `// Sincronizado automaticamente em ${new Date().toISOString().split("T")[0]}`,
      "// Para enum/set: options mapeia label → id",
      "",
      "export const DEAL_CUSTOM_FIELDS = " + JSON.stringify(mapping, null, 2) + ";",
      "",
      "// Mapa reverso: key da API → nome legível",
      "export const KEY_TO_NAME = {};",
      "for (const [name, field] of Object.entries(DEAL_CUSTOM_FIELDS)) {",
      "  KEY_TO_NAME[field.key] = name;",
      "}",
      "",
      "// Mapa reverso para enum/set: key da API → { id → label }",
      "export const KEY_TO_OPTIONS = {};",
      "for (const [name, field] of Object.entries(DEAL_CUSTOM_FIELDS)) {",
      "  if (field.options) {",
      "    const idToLabel = {};",
      "    for (const [label, id] of Object.entries(field.options)) {",
      "      idToLabel[id] = label;",
      "    }",
      "    KEY_TO_OPTIONS[field.key] = idToLabel;",
      "  }",
      "}",
      "",
    ];

    fs.writeFileSync(FIELDS_PATH, lines.join("\n"), "utf-8");

    // 5. Atualizar memória imediatamente (sem reiniciar)
    DEAL_CUSTOM_FIELDS = mapping;
    rebuildReverseMaps();

    // 6. Retornar resumo
    const summary = [
      `✅ Campos personalizados sincronizados!`,
      ``,
      `Total: ${customFields.length} campos`,
      `  • ${enumCount} enum (seleção única)`,
      `  • ${setText} set (múltipla escolha)`,
      `  • ${textCount} outros (text, double, etc.)`,
      ``,
      `Arquivo salvo em: ${FIELDS_PATH}`,
      `Campos carregados na memória — prontos para uso imediato.`,
    ];

    return { content: [{ type: "text", text: summary.join("\n") }] };
  }
);

// ─── START ────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
