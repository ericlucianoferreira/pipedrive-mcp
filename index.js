import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "fs";
import { fileURLToPath } from "url";

const CONFIG_PATH = fileURLToPath(new URL("./config.js", import.meta.url));

// Store mutável — começa vazio, preenchido pelo sync_fields ou pelo arquivo existente
let DEAL_CUSTOM_FIELDS = {};
let KEY_TO_NAME = {};
let KEY_TO_OPTIONS = {};

// Campos personalizados de pessoa — carregado de person_fields.js ou via sync_person_fields
let PERSON_CUSTOM_FIELDS = {};
let PERSON_KEY_TO_NAME = {};
let PERSON_KEY_TO_OPTIONS = {};

// Cache de etapas e pipelines — carregado do config.js ou da API
let STAGE_MAP = {};    // { id: "Nome da Etapa" }
let PIPELINE_MAP = {}; // { id: "Nome do Pipeline" }

// Usuários ativos — carregado do config.js ou da API
let ACTIVE_USERS = [];  // [{ id, name }]

// Domínio da empresa — carregado do config.js ou via /users/me no startup
let COMPANY_DOMAIN = "app"; // fallback genérico

// Tipos de atividade — carregado de activity_types.js ou da API sob demanda
let ACTIVITY_TYPES = {};   // { key_string: { name, aliases, default_duration, is_custom, active } }
let TYPE_LOOKUP = {};      // { lowercase_input: key_string } — mapa de resolução

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

function rebuildPersonReverseMaps() {
  PERSON_KEY_TO_NAME = {};
  PERSON_KEY_TO_OPTIONS = {};
  for (const [name, field] of Object.entries(PERSON_CUSTOM_FIELDS)) {
    PERSON_KEY_TO_NAME[field.key] = name;
    if (field.options) {
      const idToLabel = {};
      for (const [label, id] of Object.entries(field.options)) {
        idToLabel[id] = label;
      }
      PERSON_KEY_TO_OPTIONS[field.key] = idToLabel;
    }
  }
}

function rebuildTypeLookup() {
  TYPE_LOOKUP = {};
  for (const [key, type] of Object.entries(ACTIVITY_TYPES)) {
    if (!type.active) continue;
    const register = (alias) => {
      const normalized = alias.toLowerCase();
      if (TYPE_LOOKUP[normalized] && TYPE_LOOKUP[normalized] !== key) {
        console.error(`[pipedrive-mcp] Aviso: alias "${alias}" conflita entre tipos "${TYPE_LOOKUP[normalized]}" e "${key}". Usando "${key}".`);
      }
      TYPE_LOOKUP[normalized] = key;
    };
    register(key);
    if (type.name) register(type.name);
    for (const alias of (type.aliases || [])) register(alias);
  }
}

function resolveActivityType(input) {
  if (!input) return input;
  const resolved = TYPE_LOOKUP[input.toLowerCase()];
  if (resolved) return resolved;
  // Fallback: se TYPE_LOOKUP vazio (sem config, sem API), passa direto
  if (Object.keys(TYPE_LOOKUP).length === 0) return input;
  const valid = Object.entries(ACTIVITY_TYPES)
    .filter(([_, t]) => t.active)
    .map(([key, t]) => `  - ${t.name} (${key})` + (t.aliases?.length ? ` [aliases: ${t.aliases.join(", ")}]` : ""))
    .join("\n");
  throw new Error(`Tipo de atividade "${input}" não encontrado.\n\nTipos válidos:\n${valid}`);
}

// ─── RESOLVERS: nome → ID (usando dados do config.js) ────────────────────────

function resolvePipeline(input) {
  if (input === undefined || input === null) return undefined;
  const asNum = Number(input);
  if (!isNaN(asNum) && PIPELINE_MAP[asNum]) return asNum;
  const lower = String(input).toLowerCase();
  const exact = Object.entries(PIPELINE_MAP).find(([_, name]) => name.toLowerCase() === lower);
  if (exact) return parseInt(exact[0]);
  const partial = Object.entries(PIPELINE_MAP).find(([_, name]) => name.toLowerCase().includes(lower));
  if (partial) return parseInt(partial[0]);
  const valid = Object.entries(PIPELINE_MAP).map(([id, name]) => `  - ${name} (${id})`).join("\n");
  throw new Error(`Pipeline "${input}" não encontrado.\n\nPipelines disponíveis:\n${valid}`);
}

function resolveStage(input, pipelineId) {
  if (input === undefined || input === null) return undefined;
  const asNum = Number(input);
  if (!isNaN(asNum) && STAGES_DATA.some(s => s.id === asNum)) return asNum;
  const lower = String(input).toLowerCase();
  const candidates = pipelineId ? STAGES_DATA.filter(s => s.pipeline_id == pipelineId) : STAGES_DATA;
  const exact = candidates.find(s => s.name.toLowerCase() === lower);
  if (exact) return exact.id;
  const partial = candidates.find(s => s.name.toLowerCase().includes(lower));
  if (partial) return partial.id;
  const valid = candidates.sort((a, b) => a.order - b.order).map(s => `  - ${s.name} (${s.id})`).join("\n");
  const ctx = pipelineId ? ` no pipeline ${PIPELINE_MAP[pipelineId] || pipelineId}` : "";
  throw new Error(`Etapa "${input}" não encontrada${ctx}.\n\nEtapas disponíveis:\n${valid}`);
}

function resolveUser(input) {
  if (input === undefined || input === null) return undefined;
  const asNum = Number(input);
  if (!isNaN(asNum) && ACTIVE_USERS.some(u => u.id === asNum)) return asNum;
  const lower = String(input).toLowerCase();
  const exact = ACTIVE_USERS.find(u => u.name.toLowerCase() === lower);
  if (exact) return exact.id;
  const partial = ACTIVE_USERS.find(u => u.name.toLowerCase().includes(lower));
  if (partial) return partial.id;
  const valid = ACTIVE_USERS.map(u => `  - ${u.name} (${u.id})`).join("\n");
  throw new Error(`Usuário "${input}" não encontrado.\n\nUsuários ativos:\n${valid}`);
}

function minutesToHHMM(min) {
  if (!min) return undefined;
  const hh = String(Math.floor(min / 60)).padStart(2, "0");
  const mm = String(min % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

let _activityTypesLoadingPromise = null;
async function ensureActivityTypesLoaded() {
  if (Object.keys(ACTIVITY_TYPES).length > 0) return;
  if (_activityTypesLoadingPromise) return _activityTypesLoadingPromise;
  _activityTypesLoadingPromise = (async () => {
    try {
      const data = await pipedriveRequest("/activityTypes");
      for (const t of (data.data || [])) {
        ACTIVITY_TYPES[t.key_string] = {
          name: t.name,
          aliases: [t.name.toLowerCase()],
          default_duration: null,
          is_custom: !!t.is_custom_flag,
          active: !!t.active_flag,
        };
      }
      rebuildTypeLookup();
    } catch (err) {
      console.error("[pipedrive-mcp] Aviso: não foi possível carregar tipos de atividade da API:", err.message);
    }
  })();
  await _activityTypesLoadingPromise;
  _activityTypesLoadingPromise = null;
}

let STAGES_DATA = []; // [{ id, name, pipeline_id, order }]

async function loadStagePipelineCache() {
  try {
    const pipData = await pipedriveRequest("/pipelines");
    for (const p of pipData.data || []) PIPELINE_MAP[p.id] = p.name;
    const stData = await pipedriveRequest("/stages");
    STAGES_DATA = (stData.data || []).map(s => ({ id: s.id, name: s.name, pipeline_id: s.pipeline_id, order: s.order_nr }));
    for (const s of STAGES_DATA) STAGE_MAP[s.id] = s.name;
  } catch (err) {
    console.error("[pipedrive-mcp] Aviso: não foi possível carregar cache de etapas/pipelines:", err.message);
  }
}

// Tenta carregar config.js unificado na inicialização
try {
  const cfg = await import(new URL("./config.js", import.meta.url).href);
  const CONFIG = cfg.CONFIG || {};
  if (CONFIG.deal_custom_fields) { DEAL_CUSTOM_FIELDS = CONFIG.deal_custom_fields; rebuildReverseMaps(); }
  if (CONFIG.person_custom_fields) { PERSON_CUSTOM_FIELDS = CONFIG.person_custom_fields; rebuildPersonReverseMaps(); }
  if (CONFIG.activity_types) { ACTIVITY_TYPES = CONFIG.activity_types; rebuildTypeLookup(); }
  if (CONFIG.pipelines) {
    for (const p of CONFIG.pipelines) {
      PIPELINE_MAP[p.id] = p.name;
      for (const s of (p.stages || [])) {
        STAGE_MAP[s.id] = s.name;
        STAGES_DATA.push({ id: s.id, name: s.name, pipeline_id: p.id, order: s.order });
      }
    }
  }
  if (CONFIG.users) { ACTIVE_USERS = CONFIG.users; }
  if (CONFIG.company_domain) { COMPANY_DOMAIN = CONFIG.company_domain; }
  console.error(`[pipedrive-mcp] config.js carregado (sincronizado em ${CONFIG.synced_at || "N/A"})`);
} catch (err) {
  if (err.code === "ERR_MODULE_NOT_FOUND" || err.message?.includes("Cannot find")) {
    console.error("[pipedrive-mcp] config.js não encontrado. Execute sync_all para sincronizar.");
  } else {
    console.error("[pipedrive-mcp] Erro ao carregar config.js:", err.message);
  }
}

const API_KEY = process.env.PIPEDRIVE_API_KEY;
if (!API_KEY) {
  console.error("[pipedrive-mcp] ERRO: PIPEDRIVE_API_KEY não configurada. Defina a variável de ambiente antes de iniciar.");
  process.exit(1);
}
const BASE_URL = "https://api.pipedrive.com/v1";

// ─── TIMEZONE ─────────────────────────────────────────────────────────────────
// O Pipedrive armazena due_time em UTC. O usuário informa horários em
// America/Sao_Paulo (GMT-3 no horário de verão, GMT-3 no horário padrão).
// Esta função converte HH:MM (Brasília) → HH:MM (UTC) para envio à API.
// Na leitura (list_activities), o MCP exibe o due_time como retornado pela API
// (UTC), então também convertemos de volta para exibição ao usuário.

const USER_TIMEZONE = process.env.PIPEDRIVE_TIMEZONE || "America/Sao_Paulo";

function localToUtc(timeStr, dateStr) {
  if (!timeStr || !dateStr) return timeStr;
  // Monta um Date no fuso do usuário e extrai o UTC equivalente
  const localDt = new Date(`${dateStr}T${timeStr}:00Z`);
  // Calcula o offset do fuso do usuário nesse instante
  const tzOffset = getTzOffsetMinutes(dateStr, timeStr, USER_TIMEZONE);
  const utcMs = localDt.getTime() + tzOffset * 60 * 1000;
  const utcDt = new Date(utcMs);
  const hh = String(utcDt.getUTCHours()).padStart(2, "0");
  const mm = String(utcDt.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function utcToLocal(timeStr, dateStr) {
  if (!timeStr || !dateStr) return timeStr;
  const utcDt = new Date(`${dateStr}T${timeStr}:00Z`);
  // Usa Intl para obter o horário local correto no fuso do usuário
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: USER_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(utcDt);
  const hh = parts.find((p) => p.type === "hour")?.value ?? "00";
  const mm = parts.find((p) => p.type === "minute")?.value ?? "00";
  return `${hh}:${mm}`;
}

function getTzOffsetMinutes(dateStr, timeStr, tz) {
  // Descobre o offset (em minutos) do fuso `tz` em relação ao UTC
  // para o instante representado por dateStr + timeStr (interpretado como UTC provisoriamente)
  const probe = new Date(`${dateStr}T${timeStr}:00Z`);
  const localStr = probe.toLocaleString("en-US", { timeZone: tz, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit" });
  // localStr ex: "02/27/2026, 06:00:00"
  const [datePart, timePart] = localStr.split(", ");
  const [mo, dy, yr] = datePart.split("/");
  const [h, mi, s] = timePart.split(":");
  const localDt = new Date(Date.UTC(+yr, +mo - 1, +dy, +h, +mi, +s));
  return (probe.getTime() - localDt.getTime()) / 60000;
}

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
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    let response;
    try {
      response = await fetch(url, {
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        ...options,
      });
    } catch (fetchErr) {
      clearTimeout(timeout);
      if (fetchErr.name === "AbortError") {
        throw new Error("Timeout: Pipedrive não respondeu em 30 segundos.");
      }
      throw fetchErr;
    }
    clearTimeout(timeout);

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
    } else if (field.type === "double" || field.type === "user") {
      const num = Number(value);
      if (isNaN(num)) {
        errors.push(`"${name}": valor "${value}" não é um número válido.`);
        continue;
      }
      body[field.key] = num;
    } else {
      body[field.key] = String(value);
    }
  }
  return { body, errors };
}

function resolvePersonCustomFields(fields) {
  const body = {};
  const errors = [];
  for (const [name, value] of Object.entries(fields)) {
    const field = PERSON_CUSTOM_FIELDS[name];
    if (!field) { errors.push(`Campo de pessoa "${name}" não existe. Execute sync_person_fields para atualizar.`); continue; }
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
    } else if (field.type === "double" || field.type === "user") {
      const num = Number(value);
      if (isNaN(num)) {
        errors.push(`"${name}": valor "${value}" não é um número válido.`);
        continue;
      }
      body[field.key] = num;
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
    etapa: STAGE_MAP[deal.stage_id] || deal.stage_id,
    pipeline: PIPELINE_MAP[deal.pipeline_id] || deal.pipeline_id,
    contato: deal.person_name,
    contato_id: deal.person_id,
    empresa: deal.org_name,
    empresa_id: deal.org_id,
    responsavel: deal.owner_name,
    responsavel_id: deal.user_id,
    criado_em: deal.add_time,
    atualizado_em: deal.update_time,
    previsao_fechamento: deal.expected_close_date,
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
  version: "6.0.0",
});

// ─── REFRESH DE DADOS VIA API (usa config.js como fallback se API falhar) ───

try {
  await loadStagePipelineCache();
  await ensureActivityTypesLoaded();
  const userData = await pipedriveRequest("/users?limit=500");
  ACTIVE_USERS = (userData.data || []).filter(u => u.active_flag).map(u => ({ id: u.id, name: u.name }));
  const me = await pipedriveRequest("/users/me");
  if (me.data?.company_domain) COMPANY_DOMAIN = me.data.company_domain;
} catch (err) {
  // Se API falhar, usa dados do config.js (já carregados acima)
  if (Object.keys(PIPELINE_MAP).length > 0) {
    console.error("[pipedrive-mcp] API indisponível — usando dados do config.js");
  } else {
    console.error("[pipedrive-mcp] Aviso: sem dados de referência (API falhou e config.js não existe). Execute sync_all.");
  }
}

// Referências inline removidas — resolução por nome/ID acontece dentro de cada tool via
// resolvePipeline(), resolveStage(), resolveUser(), resolveActivityType()

// ─── NEGÓCIOS ────────────────────────────────────────────────────────────────

server.tool(
  "list_deals",
  "Lista negócios do Pipedrive. Pode filtrar por status e pipeline. Suporta paginação via start/limit e busca automática de todos os registros via buscar_todos.",
  {
    status: z.enum(["open", "won", "lost", "all"]).optional().default("open").describe("Status dos negócios"),
    pipeline_id: z.number().optional().describe("ID do pipeline para filtrar"),
    stage_id: z.number().optional().describe("ID da etapa para filtrar"),
    user_id: z.number().optional().describe("ID do responsável para filtrar"),
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
      etapa: STAGE_MAP[d.stage_id] || d.stage_id,
      pipeline: PIPELINE_MAP[d.pipeline_id] || d.pipeline_id,
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
      const MAX_REQUESTS = 10;
      let requestCount = 0;

      while (allDeals.length < MAX_RECORDS && requestCount < MAX_REQUESTS) {
        requestCount++;
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
      etapa: STAGE_MAP[i.item.stage_id] || i.item.stage_id,
      pipeline: PIPELINE_MAP[i.item.pipeline_id] || i.item.pipeline_id,
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
  "Cria um novo negócio no Pipedrive. Aceita nome ou ID para pipeline, etapa e responsável (resolve automaticamente via config). Se person_id for informado, verifica se já existe deal aberto. Aceita campos personalizados via custom_fields.",
  {
    title: z.string().describe("Título do negócio"),
    value: z.number().optional().describe("Valor do negócio"),
    currency: z.string().optional().default("BRL").describe("Moeda (padrão BRL)"),
    person_id: z.number().optional().describe("ID do contato"),
    org_id: z.number().optional().describe("ID da organização"),
    pipeline_id: z.union([z.string(), z.number()]).optional().describe("Nome ou ID do pipeline. Ex: 'Educacional', 'Super SDR', 6"),
    stage_id: z.union([z.string(), z.number()]).optional().describe("Nome ou ID da etapa. Ex: 'Apresentação Agendada', 54"),
    user_id: z.union([z.string(), z.number()]).optional().describe("Nome ou ID do responsável. Ex: 'Eric Luciano', 17987703. Se omitido, atribui ao dono do token."),
    custom_fields: z.string().optional().describe('JSON com campos personalizados. Ex: {"Segmento": "Jurídico", "Origem da Oportunidade": "INDIC | Geral"}'),
    force: z.boolean().optional().default(false).describe("Se true, cria mesmo se existir deal aberto para o contato. Use SOMENTE após confirmação explícita do usuário."),
  },
  async ({ title, value, currency, person_id, org_id, pipeline_id, stage_id, user_id, custom_fields, force }) => {
    // ── Resolver nomes para IDs ──
    try {
      pipeline_id = resolvePipeline(pipeline_id);
      stage_id = resolveStage(stage_id, pipeline_id);
      user_id = resolveUser(user_id);
    } catch (e) {
      return { content: [{ type: "text", text: e.message }] };
    }
    // ── Guardrail: verificar deals abertos para o contato ──
    if (person_id && !force) {
      try {
        const personDeals = await pipedriveRequest(`/persons/${person_id}/deals?status=open&limit=100`);
        const openDeals = (personDeals.data || []).map((d) => ({
          id: d.id,
          titulo: d.title,
          valor: d.value,
          moeda: d.currency,
          etapa: STAGE_MAP[d.stage_id] || d.stage_id,
          pipeline: PIPELINE_MAP[d.pipeline_id] || d.pipeline_id,
          responsavel: d.owner_name,
        }));
        if (openDeals.length > 0) {
          const lines = openDeals.map((d) => {
            const valor = d.valor ? ` | Valor: R$${d.valor.toLocaleString("pt-BR")}` : "";
            return `- "${d.titulo}" (ID: ${d.id}) | Etapa: ${d.etapa} | Pipeline: ${d.pipeline}${valor} | Resp: ${d.responsavel}\n  https://${COMPANY_DOMAIN}.pipedrive.com/deal/${d.id}`;
          });
          return {
            content: [{
              type: "text",
              text: `⚠ DEAL ABERTO EXISTENTE — este contato já tem ${openDeals.length} negócio(s) aberto(s):\n\n${lines.join("\n\n")}\n\nSe realmente deseja criar um NOVO deal, chame create_deal novamente com force: true.`,
            }],
          };
        }
      } catch { /* ignora erro — continua com criação */ }
    }

    // ── Criar deal ──
    const body = { title, currency, visible_to: 3 }; // 3 = empresa inteira
    if (value !== undefined) body.value = value;
    if (person_id) body.person_id = person_id;
    if (org_id) body.org_id = org_id;
    if (pipeline_id) body.pipeline_id = pipeline_id;
    if (stage_id) body.stage_id = stage_id;
    if (user_id) body.user_id = user_id;
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
    let msg = `Negócio criado! ID: ${data.data.id} — "${data.data.title}"\nhttps://${COMPANY_DOMAIN}.pipedrive.com/deal/${data.data.id}`;
    if (warnings.length > 0) msg += `\n\nAvisos:\n${warnings.join("\n")}`;
    return { content: [{ type: "text", text: msg }] };
  }
);

server.tool(
  "update_deal",
  "Atualiza um negócio (status, etapa, pipeline, valor, etc.). Aceita nome ou ID para pipeline, etapa e responsável.",
  {
    deal_id: z.number().describe("ID do negócio"),
    title: z.string().optional().describe("Novo título"),
    value: z.number().optional().describe("Novo valor"),
    stage_id: z.union([z.string(), z.number()]).optional().describe("Nome ou ID da nova etapa. Ex: 'Proposta enviada', 20"),
    pipeline_id: z.union([z.string(), z.number()]).optional().describe("Nome ou ID do novo pipeline. Ex: 'SaaS', 1"),
    status: z.enum(["open", "won", "lost"]).optional().describe("Novo status"),
    lost_reason: z.enum(["Parou de responder", "Fora do orçamento", "Adiou contratação", "Mudança de prioridade", "Contratou outra empresa", "Internalizou", "Não é o que buscava", "Ferramenta incompatível / Desqualificado"]).optional().describe("Motivo da perda (obrigatório quando status=lost). Use exatamente um dos 8 motivos padronizados."),
    lost_time: z.string().optional().describe("Data/hora da perda no formato 'YYYY-MM-DD HH:MM:SS'. Permite definir data retroativa de perda."),
    user_id: z.union([z.string(), z.number()]).optional().describe("Nome ou ID do novo responsável. Ex: 'Eric Luciano', 17987703"),
    expected_close_date: z.string().optional().describe("Data prevista de fechamento no formato YYYY-MM-DD"),
  },
  async ({ deal_id, title, value, stage_id, pipeline_id, status, lost_reason, lost_time, user_id, expected_close_date }) => {
    // ── Resolver nomes para IDs ──
    try {
      pipeline_id = resolvePipeline(pipeline_id);
      stage_id = resolveStage(stage_id, pipeline_id);
      user_id = resolveUser(user_id);
    } catch (e) {
      return { content: [{ type: "text", text: e.message }] };
    }
    const body = {};
    if (title) body.title = title;
    if (value !== undefined) body.value = value;
    if (stage_id) body.stage_id = stage_id;
    if (pipeline_id) body.pipeline_id = pipeline_id;
    if (status) body.status = status;
    if (lost_reason) body.lost_reason = lost_reason;
    if (lost_time) body.lost_time = lost_time;
    if (user_id) body.user_id = user_id;
    if (expected_close_date) body.expected_close_date = expected_close_date;
    await pipedriveRequest(`/deals/${deal_id}`, {
      method: "PUT",
      body: JSON.stringify(body),
    });
    return { content: [{ type: "text", text: `Negócio ${deal_id} atualizado com sucesso.\nhttps://${COMPANY_DOMAIN}.pipedrive.com/deal/${deal_id}` }] };
  }
);

server.tool(
  "get_deal_flow",
  "Retorna o histórico de mudanças de um deal com parsing inteligente. Extrai mudanças de status (open/lost/won), mudanças de etapa, e timestamps exatos. Útil para descobrir data original de perda, motivo de perda, e rastrear movimentações do deal.",
  {
    deal_id: z.number().describe("ID do negócio"),
    filter: z.enum(["all", "status", "stage"]).optional().default("all").describe("Filtrar tipo de mudança: 'all' = tudo, 'status' = só mudanças open/lost/won, 'stage' = só mudanças de etapa"),
    limit: z.number().optional().default(100).describe("Quantidade máxima de resultados (máx 500)"),
  },
  async ({ deal_id, filter, limit }) => {
    const effectiveLimit = Math.min(limit, 500);
    const data = await pipedriveRequest(`/deals/${deal_id}/flow?limit=${effectiveLimit}`);
    const allItems = data.data || [];

    const statusChanges = [];
    const stageChanges = [];
    const allChanges = [];

    for (const item of allItems) {
      const ts = item.timestamp;
      // Mudanças em campos do deal
      if (item.object === "dealChange" && item.data) {
        const d = item.data;
        if (d.field_key === "status") {
          const change = {
            tipo: "status",
            timestamp: ts,
            de: d.old_value,
            para: d.new_value,
          };
          statusChanges.push(change);
          allChanges.push(change);
        }
        if (d.field_key === "stage_id") {
          const change = {
            tipo: "etapa",
            timestamp: ts,
            de: STAGE_MAP[d.old_value] || d.old_value,
            para: STAGE_MAP[d.new_value] || d.new_value,
          };
          stageChanges.push(change);
          allChanges.push(change);
        }
        if (d.field_key === "lost_reason") {
          const change = {
            tipo: "motivo_perda",
            timestamp: ts,
            de: d.old_value,
            para: d.new_value,
          };
          allChanges.push(change);
        }
      }
      // Atividades e notas também aparecem no flow
      if (item.object === "activity" && filter === "all") {
        allChanges.push({
          tipo: "atividade",
          timestamp: ts,
          acao: item.action,
          dados: { subject: item.data?.subject, type: item.data?.type },
        });
      }
      if (item.object === "note" && filter === "all") {
        allChanges.push({
          tipo: "nota",
          timestamp: ts,
          acao: item.action,
        });
      }
    }

    let result;
    if (filter === "status") {
      result = { mudancas_status: statusChanges, total: statusChanges.length };
    } else if (filter === "stage") {
      result = { mudancas_etapa: stageChanges, total: stageChanges.length };
    } else {
      result = {
        resumo: {
          mudancas_status: statusChanges.length,
          mudancas_etapa: stageChanges.length,
          total_eventos: allChanges.length,
        },
        mudancas_status: statusChanges,
        mudancas_etapa: stageChanges,
        todos_eventos: allChanges,
      };
    }
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
    if (!content || content.trim() === "") {
      return { content: [{ type: "text", text: "Erro: o campo 'content' é obrigatório para criar uma nota." }] };
    }
    if (!deal_id && !person_id && !org_id) {
      return { content: [{ type: "text", text: "Erro: informe pelo menos um vínculo — deal_id, person_id ou org_id." }] };
    }
    const body = { content };
    if (deal_id) body.deal_id = deal_id;
    if (person_id) body.person_id = person_id;
    if (org_id) body.org_id = org_id;
    const data = await pipedriveRequest("/notes", {
      method: "POST",
      body: JSON.stringify(body),
    });
    const dealLink = deal_id ? `\nhttps://${COMPANY_DOMAIN}.pipedrive.com/deal/${deal_id}` : "";
    return { content: [{ type: "text", text: `Nota criada! ID: ${data.data.id}${dealLink}` }] };
  }
);

server.tool(
  "update_note",
  "Edita o conteúdo de uma nota existente e/ou pina/despina no deal. O conteúdo suporta HTML.",
  {
    note_id: z.number().describe("ID da nota a editar"),
    content: z.string().optional().describe("Novo conteúdo da nota (suporta HTML)"),
    pinned: z.boolean().optional().describe("true = pinar nota no deal, false = despinar"),
  },
  async ({ note_id, content, pinned }) => {
    if (content === undefined && pinned === undefined) {
      return { content: [{ type: "text", text: "Erro: informe ao menos 'content' ou 'pinned' para atualizar a nota." }] };
    }
    const body = {};
    if (content !== undefined) body.content = content;
    if (pinned !== undefined) body.pinned_to_deal_flag = pinned ? 1 : 0;
    await pipedriveRequest(`/notes/${note_id}`, {
      method: "PUT",
      body: JSON.stringify(body),
    });
    const actions = [];
    if (content !== undefined) actions.push("conteúdo atualizado");
    if (pinned !== undefined) actions.push(pinned ? "pinada no deal" : "desafixada do deal");
    return { content: [{ type: "text", text: `Nota ${note_id} ${actions.join(" e ")}.` }] };
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
  "Cria um novo contato no Pipedrive. IMPORTANTE: Antes de criar, o MCP busca automaticamente por duplicatas (últimos 8 dígitos do telefone e/ou email). Se encontrar, retorna aviso com link em vez de criar.",
  {
    name: z.string().describe("Nome do contato"),
    email: z.string().optional().describe("E-mail do contato"),
    phone: z.string().optional().describe("Telefone do contato"),
    org_id: z.number().optional().describe("ID da organização"),
    custom_fields: z.string().optional().describe('JSON com campos personalizados de contato. Ex: {"Origem do Contato": "Super SDR"}. Execute sync_person_fields primeiro.'),
    force: z.boolean().optional().default(false).describe("Se true, cria mesmo se encontrar duplicata. Use SOMENTE após confirmação explícita do usuário."),
  },
  async ({ name, email, phone, org_id, custom_fields, force }) => {
    // ── Guardrail: buscar duplicatas antes de criar ──
    if (!force) {
      const duplicates = [];

      // Busca por telefone (últimos 8 dígitos — ignora DDD e 9º dígito WhatsApp)
      if (phone) {
        const digitsOnly = phone.replace(/\D/g, "");
        const last8 = digitsOnly.slice(-8);
        if (last8.length === 8) {
          try {
            const phoneSearch = await pipedriveRequest(`/persons/search?term=${encodeURIComponent(last8)}&limit=5&fields=phone`);
            const phoneMatches = (phoneSearch.data?.items || []).map((i) => ({
              id: i.item.id,
              nome: i.item.name,
              telefones: i.item.phones || [],
              emails: i.item.emails || [],
              empresa: i.item.organization?.name || null,
            }));
            for (const m of phoneMatches) {
              if (!duplicates.some((d) => d.id === m.id)) duplicates.push(m);
            }
          } catch { /* ignora erro de busca */ }
        }
      }

      // Busca por email
      if (email) {
        try {
          const emailSearch = await pipedriveRequest(`/persons/search?term=${encodeURIComponent(email)}&limit=5&fields=email`);
          const emailMatches = (emailSearch.data?.items || []).map((i) => ({
            id: i.item.id,
            nome: i.item.name,
            telefones: i.item.phones || [],
            emails: i.item.emails || [],
            empresa: i.item.organization?.name || null,
          }));
          for (const m of emailMatches) {
            if (!duplicates.some((d) => d.id === m.id)) duplicates.push(m);
          }
        } catch { /* ignora erro de busca */ }
      }

      if (duplicates.length > 0) {
        const lines = duplicates.map((d) => {
          const phones = d.telefones.map((p) => p.value || p).join(", ") || "sem telefone";
          const emails = d.emails.map((e) => e.value || e).join(", ") || "sem email";
          return `- ${d.nome} (ID: ${d.id}) | Tel: ${phones} | Email: ${emails} | Empresa: ${d.empresa || "N/A"}\n  https://${COMPANY_DOMAIN}.pipedrive.com/person/${d.id}`;
        });
        return {
          content: [{
            type: "text",
            text: `⚠ POSSÍVEL DUPLICATA — encontrei ${duplicates.length} contato(s) similar(es):\n\n${lines.join("\n\n")}\n\nSe realmente deseja criar um NOVO contato, chame create_person novamente com force: true.`,
          }],
        };
      }
    }

    // ── Criar contato ──
    const body = { name, visible_to: 3 }; // 3 = empresa inteira
    if (email) body.email = [{ value: email, primary: true }];
    if (phone) body.phone = [{ value: phone, primary: true }];
    if (org_id) body.org_id = org_id;

    // Campos personalizados de contato
    if (custom_fields) {
      let parsed;
      try { parsed = JSON.parse(custom_fields); } catch { return { content: [{ type: "text", text: "Erro: custom_fields não é um JSON válido." }] }; }
      const { body: cfBody, errors } = resolvePersonCustomFields(parsed);
      if (errors.length > 0) {
        return { content: [{ type: "text", text: `Erros nos campos personalizados:\n${errors.join("\n")}` }] };
      }
      Object.assign(body, cfBody);
    }

    const data = await pipedriveRequest("/persons", {
      method: "POST",
      body: JSON.stringify(body),
    });
    return { content: [{ type: "text", text: `Contato criado! ID: ${data.data.id} — "${data.data.name}"\nhttps://${COMPANY_DOMAIN}.pipedrive.com/person/${data.data.id}` }] };
  }
);

server.tool(
  "update_person",
  "Atualiza um contato (nome, email, telefone, organização). IMPORTANTE: Antes de atualizar, verifica campos existentes e avisa sobre possíveis sobrescritas. Email e telefone são ADICIONADOS (não substituem os existentes).",
  {
    person_id: z.number().describe("ID do contato"),
    name: z.string().optional().describe("Novo nome"),
    email: z.string().optional().describe("Novo e-mail"),
    phone: z.string().optional().describe("Novo telefone"),
    org_id: z.number().optional().describe("ID da nova organização"),
    custom_fields: z.string().optional().describe('JSON com campos personalizados de contato. Ex: {"Origem do Contato": "Super SDR"}. Execute sync_person_fields primeiro.'),
    force: z.boolean().optional().default(false).describe("Se true, aplica alterações mesmo em campos que já têm valor. Use SOMENTE após confirmação explícita do usuário."),
  },
  async ({ person_id, name, email, phone, org_id, custom_fields, force }) => {
    // ── Guardrail: buscar dados atuais e avisar sobre sobrescritas ──
    const current = await pipedriveRequest(`/persons/${person_id}`);
    const person = current.data;
    const conflicts = [];

    if (name && person.name && person.name !== name) {
      conflicts.push(`Nome: "${person.name}" → "${name}"`);
    }
    if (org_id && person.org_id && person.org_id.value !== org_id) {
      conflicts.push(`Organização: "${person.org_id.name || person.org_id.value}" → ID ${org_id}`);
    }

    if (conflicts.length > 0 && !force) {
      return {
        content: [{
          type: "text",
          text: `⚠ CAMPOS JÁ PREENCHIDOS no contato "${person.name}" (ID: ${person_id}):\n\n${conflicts.map((c) => `- ${c}`).join("\n")}\n\nhttps://${COMPANY_DOMAIN}.pipedrive.com/person/${person_id}\n\nSe realmente deseja sobrescrever, chame update_person novamente com force: true.`,
        }],
      };
    }

    const body = {};
    if (name) body.name = name;
    if (org_id) body.org_id = org_id;

    // Para email e phone: ADICIONAR em vez de substituir
    if (email) {
      const existingEmails = person.email || [];
      const alreadyExists = existingEmails.some((e) => e.value === email);
      if (alreadyExists) {
        // Email já existe — não precisa atualizar
      } else {
        body.email = [...existingEmails, { value: email, primary: existingEmails.length === 0 }];
      }
    }
    if (phone) {
      const existingPhones = person.phone || [];
      const alreadyExists = existingPhones.some((p) => p.value === phone);
      if (alreadyExists) {
        // Telefone já existe — não precisa atualizar
      } else {
        body.phone = [...existingPhones, { value: phone, primary: existingPhones.length === 0 }];
      }
    }

    // Campos personalizados de contato
    if (custom_fields) {
      let parsed;
      try { parsed = JSON.parse(custom_fields); } catch { return { content: [{ type: "text", text: "Erro: custom_fields não é um JSON válido." }] }; }
      const { body: cfBody, errors } = resolvePersonCustomFields(parsed);
      if (errors.length > 0) {
        return { content: [{ type: "text", text: `Erros nos campos personalizados:\n${errors.join("\n")}` }] };
      }
      Object.assign(body, cfBody);
    }

    // Se não há nada para atualizar
    if (Object.keys(body).length === 0) {
      const msgs = [];
      if (email) msgs.push(`Email "${email}" já existe neste contato.`);
      if (phone) msgs.push(`Telefone "${phone}" já existe neste contato.`);
      if (msgs.length > 0) {
        return { content: [{ type: "text", text: `Nenhuma alteração necessária. ${msgs.join(" ")}` }] };
      }
      return { content: [{ type: "text", text: "Nenhum campo para atualizar." }] };
    }

    await pipedriveRequest(`/persons/${person_id}`, {
      method: "PUT",
      body: JSON.stringify(body),
    });

    let msg = `Contato ${person_id} atualizado com sucesso.\nhttps://${COMPANY_DOMAIN}.pipedrive.com/person/${person_id}`;
    if (email && body.email) msg += `\nEmail "${email}" adicionado.`;
    if (phone && body.phone) msg += `\nTelefone "${phone}" adicionado.`;
    return { content: [{ type: "text", text: msg }] };
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
  "Cria uma nova organização/empresa no Pipedrive. Verifica duplicatas automaticamente. Aceita nome ou ID para responsável.",
  {
    name: z.string().describe("Nome da organização"),
    address: z.string().optional().describe("Endereço da organização"),
    owner_id: z.union([z.string(), z.number()]).optional().describe("Nome ou ID do responsável. Ex: 'Eric Luciano'"),
    force: z.boolean().optional().default(false).describe("Se true, cria mesmo se encontrar organização similar."),
  },
  async ({ name, address, owner_id, force }) => {
    // ── Resolver nome do responsável ──
    try { owner_id = resolveUser(owner_id); } catch (e) { return { content: [{ type: "text", text: e.message }] }; }
    // ── Guardrail: buscar organizações similares antes de criar ──
    if (!force) {
      try {
        const orgSearch = await pipedriveRequest(`/organizations/search?term=${encodeURIComponent(name)}&limit=5`);
        const matches = (orgSearch.data?.items || []).map((i) => ({
          id: i.item.id,
          nome: i.item.name,
          endereco: i.item.address,
          negocios_abertos: i.item.open_deals_count,
        }));
        if (matches.length > 0) {
          const lines = matches.map((m) => {
            const addr = m.endereco ? ` | End: ${m.endereco}` : "";
            return `- "${m.nome}" (ID: ${m.id}) | Deals abertos: ${m.negocios_abertos || 0}${addr}\n  https://${COMPANY_DOMAIN}.pipedrive.com/organization/${m.id}`;
          });
          return {
            content: [{
              type: "text",
              text: `⚠ ORGANIZAÇÃO SIMILAR ENCONTRADA — ${matches.length} resultado(s):\n\n${lines.join("\n\n")}\n\nSe realmente deseja criar uma NOVA organização, chame create_organization novamente com force: true.`,
            }],
          };
        }
      } catch { /* ignora erro de busca */ }
    }

    // ── Criar organização ──
    const body = { name, visible_to: 3 }; // 3 = empresa inteira
    if (address) body.address = address;
    if (owner_id) body.owner_id = owner_id;
    const data = await pipedriveRequest("/organizations", {
      method: "POST",
      body: JSON.stringify(body),
    });
    return { content: [{ type: "text", text: `Organização criada! ID: ${data.data.id} — "${data.data.name}"\nhttps://${COMPANY_DOMAIN}.pipedrive.com/organization/${data.data.id}` }] };
  }
);

// ─── ATIVIDADES ───────────────────────────────────────────────────────────────


server.tool(
  "list_activities",
  "Lista atividades do Pipedrive. Pode filtrar por usuário, tipo, período (due_date), negócio e status. Inclui indicador 'atrasada' para atividades vencidas. Quando start_date/end_date são fornecidos, busca automaticamente todas as páginas e filtra por due_date no lado do servidor.",
  {
    done: z.boolean().optional().default(false).describe("Listar atividades concluídas (false = pendentes)"),
    limit: z.number().optional().default(100).describe("Quantidade máxima de resultados por página (máx 500). Ignorado quando start_date/end_date são fornecidos (busca todas as páginas)."),
    start: z.number().optional().default(0).describe("Offset para paginação"),
    user_id: z.number().optional().describe("Filtrar por usuário (ID)"),
    type: z.string().optional().describe("Filtrar por tipo de atividade. Aceita key da API, nome ou alias."),
    start_date: z.string().optional().describe("Data inicial do filtro por due_date (YYYY-MM-DD). Filtra no lado do cliente após buscar todas as páginas."),
    end_date: z.string().optional().describe("Data final do filtro por due_date (YYYY-MM-DD). Filtra no lado do cliente após buscar todas as páginas."),
    deal_id: z.number().optional().describe("Filtrar por negócio (ID)"),
  },
  async ({ done, limit, start, user_id, type, start_date, end_date, deal_id }) => {
    await ensureActivityTypesLoaded();
    if (type) type = resolveActivityType(type);
    const today = new Date().toISOString().split("T")[0];

    // Se filtro de data fornecido, busca TODAS as páginas e filtra por due_date no cliente
    // (A API do Pipedrive filtra start_date/end_date por data de criação, não por due_date)
    if (start_date || end_date) {
      const PAGE_SIZE = 500;
      let allActivities = [];
      let offset = 0;
      let hasMore = true;

      while (hasMore) {
        let path = `/activities?done=${done ? 1 : 0}&limit=${PAGE_SIZE}&start=${offset}`;
        if (user_id) path += `&user_id=${user_id}`;
        if (type) path += `&type=${type}`;
        if (deal_id) path += `&deal_id=${deal_id}`;
        const data = await pipedriveRequest(path);
        const page = (data.data || []);
        allActivities = allActivities.concat(page);
        const pagination = data.additional_data?.pagination || {};
        hasMore = pagination.more_items_in_collection || false;
        offset = pagination.next_start || (offset + PAGE_SIZE);
        if (page.length === 0) hasMore = false;
      }

      // Filtra por due_date no cliente
      const filtered = allActivities.filter((a) => {
        if (!a.due_date) return false;
        if (start_date && a.due_date < start_date) return false;
        if (end_date && a.due_date > end_date) return false;
        return true;
      });

      const activities = filtered.map((a) => ({
        id: a.id,
        tipo: ACTIVITY_TYPES[a.type]?.name || a.type,
        assunto: a.subject,
        data: a.due_date,
        hora: utcToLocal(a.due_time, a.due_date), // converte UTC → Brasília para exibição
        duracao: a.duration || null,
        concluida: a.done,
        atrasada: !a.done && a.due_date ? a.due_date < today : false,
        negocio_id: a.deal_id,
        negocio: a.deal_title,
        contato: a.person_name,
        responsavel: a.owner_name,
      }));

      const result = {
        dados: activities,
        paginacao: {
          total_encontrado: activities.length,
          total_varrido: allActivities.length,
          filtro_aplicado: { start_date, end_date },
          mais_itens: false,
          proximo_inicio: null,
        },
      };
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }

    // Sem filtro de data: comportamento original com paginação manual
    const effectiveLimit = Math.min(limit, 500);
    let path = `/activities?done=${done ? 1 : 0}&limit=${effectiveLimit}&start=${start}`;
    if (user_id) path += `&user_id=${user_id}`;
    if (type) path += `&type=${type}`;
    if (deal_id) path += `&deal_id=${deal_id}`;
    const data = await pipedriveRequest(path);
    const activities = (data.data || []).map((a) => ({
      id: a.id,
      tipo: ACTIVITY_TYPES[a.type]?.name || a.type,
      assunto: a.subject,
      data: a.due_date,
      hora: utcToLocal(a.due_time, a.due_date), // converte UTC → Brasília para exibição
      duracao: a.duration || null,
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
  "list_deal_activities",
  "Lista TODAS as atividades de um negócio específico (via endpoint /deals/{id}/activities). Mais confiável que list_activities com deal_id, pois filtra corretamente no servidor.",
  {
    deal_id: z.number().describe("ID do negócio"),
    done: z.enum(["0", "1", "all"]).optional().default("all").describe("Filtrar por status: '0' = pendentes, '1' = concluídas, 'all' = todas"),
    limit: z.number().optional().default(100).describe("Quantidade máxima de resultados (máx 500)"),
    start: z.number().optional().default(0).describe("Offset para paginação"),
  },
  async ({ deal_id, done, limit, start }) => {
    await ensureActivityTypesLoaded();
    const effectiveLimit = Math.min(limit, 500);
    let path = `/deals/${deal_id}/activities?limit=${effectiveLimit}&start=${start}`;
    if (done !== "all") path += `&done=${done}`;
    const data = await pipedriveRequest(path);
    const today = new Date().toISOString().split("T")[0];
    const activities = (data.data || []).map((a) => ({
      id: a.id,
      tipo: ACTIVITY_TYPES[a.type]?.name || a.type,
      assunto: a.subject,
      data: a.due_date,
      hora: utcToLocal(a.due_time, a.due_date), // converte UTC → Brasília para exibição
      duracao: a.duration || null,
      concluida: a.done,
      atrasada: !a.done && a.due_date ? a.due_date < today : false,
      negocio_id: a.deal_id,
      negocio: a.deal_title,
      contato: a.person_name,
      responsavel_id: a.user_id,
      responsavel: a.owner_name,
      nota: a.note,
    }));
    const pagination = data.additional_data?.pagination || {};
    const result = {
      deal_id: deal_id,
      total_atividades: activities.length,
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
  "create_activity",
  "Cria uma nova atividade/tarefa no Pipedrive. Aceita nome ou alias para tipo e responsável (resolve automaticamente). Horários em fuso local (converte para UTC). Se deal_id ou person_id informado, verifica atividades pendentes antes de criar.",
  {
    subject: z.string().describe("Assunto da atividade"),
    type: z.string().describe("Tipo da atividade. Aceita key, nome ou alias. Ex: 'whatsapp', 'Demonstração', 'call'"),
    due_date: z.string().optional().describe("Data de vencimento (YYYY-MM-DD)"),
    due_time: z.string().optional().describe("Hora de vencimento em horário local (HH:MM). Convertido para UTC automaticamente."),
    duration: z.number().optional().describe("Duração em minutos. Se omitido, usa duração padrão do tipo."),
    deal_id: z.number().optional().describe("ID do negócio. SEMPRE informar quando pertence a um deal."),
    person_id: z.number().optional().describe("ID do contato relacionado"),
    user_id: z.union([z.string(), z.number()]).optional().describe("Nome ou ID do responsável. Ex: 'Eric Luciano', 17987703"),
    note: z.string().optional().describe("Nota/observação"),
    force: z.boolean().optional().default(false).describe("Se true, cria mesmo se encontrar atividade pendente."),
  },
  async ({ subject, type, due_date, due_time, duration, deal_id, person_id, user_id, note, force }) => {
    // ── Resolver nome do responsável ──
    try { user_id = resolveUser(user_id); } catch (e) { return { content: [{ type: "text", text: e.message }] }; }
    await ensureActivityTypesLoaded();
    const resolvedType = resolveActivityType(type);

    // ── Guardrail: buscar QUALQUER atividade pendente vinculada ao deal/pessoa ──
    if (!force && (deal_id || person_id)) {
      try {
        let pendingActivities = [];

        if (deal_id) {
          const dealActs = await pipedriveRequest(`/deals/${deal_id}/activities?done=0&limit=100`);
          pendingActivities = dealActs.data || [];
        } else if (person_id) {
          const personActs = await pipedriveRequest(`/activities?done=0&limit=100`);
          pendingActivities = (personActs.data || []).filter((a) => a.person_id === person_id);
        }

        if (pendingActivities.length > 0) {
          const lines = pendingActivities.map((a) => {
            const typeName = ACTIVITY_TYPES[a.type]?.name || a.type;
            const time = a.due_time ? ` às ${utcToLocal(a.due_time, a.due_date)}` : "";
            const dealInfo = a.deal_id ? `\n  Deal: https://${COMPANY_DOMAIN}.pipedrive.com/deal/${a.deal_id}` : "";
            return `- "${a.subject}" (ID: ${a.id}) | Tipo: ${typeName} | Data: ${a.due_date || "sem data"}${time}${dealInfo}`;
          });
          const context = deal_id ? "este deal" : "este contato";
          return {
            content: [{
              type: "text",
              text: `⚠ ATIVIDADE PENDENTE EXISTENTE — ${context} já tem ${pendingActivities.length} atividade(s) em aberto:\n\n${lines.join("\n\n")}\n\nSe realmente deseja criar uma NOVA atividade, chame create_activity novamente com force: true.`,
            }],
          };
        }
      } catch { /* ignora erro — continua com criação */ }
    }

    // ── Criar atividade ──
    const body = { subject, type: resolvedType, due_date };
    // Duração: explícita > default do config > nenhuma
    const dur = duration || ACTIVITY_TYPES[resolvedType]?.default_duration;
    if (dur) body.duration = minutesToHHMM(dur);
    if (due_time) body.due_time = localToUtc(due_time, due_date); // converte Brasília → UTC
    if (deal_id) body.deal_id = deal_id;
    if (person_id) body.person_id = person_id;
    if (user_id) body.user_id = user_id;
    if (note) body.note = note.replace(/\n/g, "<br>"); // API ignora \n, aceita HTML <br>
    const data = await pipedriveRequest("/activities", {
      method: "POST",
      body: JSON.stringify(body),
    });
    const dealLink = data.data.deal_id ? `\nhttps://${COMPANY_DOMAIN}.pipedrive.com/deal/${data.data.deal_id}` : "";
    return { content: [{ type: "text", text: `Atividade criada! ID: ${data.data.id} — "${data.data.subject}"${dealLink}` }] };
  }
);

server.tool(
  "update_activity",
  "Atualiza uma atividade: marcar como feita, reagendar, mudar responsável ou tipo. Aceita nome ou ID para tipo e responsável. Horários em fuso local.",
  {
    activity_id: z.number().describe("ID da atividade"),
    done: z.boolean().optional().describe("Marcar como concluída (true) ou pendente (false)"),
    subject: z.string().optional().describe("Novo assunto"),
    type: z.string().optional().describe("Novo tipo. Aceita key, nome ou alias. Ex: 'whatsapp', 'call'"),
    due_date: z.string().optional().describe("Nova data (YYYY-MM-DD)"),
    due_time: z.string().optional().describe("Nova hora em horário local (HH:MM)"),
    duration: z.number().optional().describe("Nova duração em minutos."),
    user_id: z.union([z.string(), z.number()]).optional().describe("Nome ou ID do novo responsável. Ex: 'Eric Luciano'"),
    deal_id: z.number().optional().describe("Vincular a um negócio (deal_id)"),
    note: z.string().optional().describe("Nova nota/observação"),
  },
  async ({ activity_id, done, subject, type, due_date, due_time, duration, user_id, deal_id, note }) => {
    // ── Resolver nome do responsável ──
    try { user_id = resolveUser(user_id); } catch (e) { return { content: [{ type: "text", text: e.message }] }; }
    await ensureActivityTypesLoaded();
    const body = {};
    if (done !== undefined) body.done = done ? 1 : 0;
    if (subject) body.subject = subject;
    if (type) body.type = resolveActivityType(type);
    if (due_date) body.due_date = due_date;
    // converte Brasília → UTC; se vier due_time sem due_date, usa hoje como referência
    if (due_time) body.due_time = localToUtc(due_time, due_date || new Date().toISOString().slice(0, 10));
    if (duration) body.duration = minutesToHHMM(duration);
    if (user_id) body.user_id = user_id;
    if (deal_id) body.deal_id = deal_id;
    if (note) body.note = note.replace(/\n/g, "<br>"); // API ignora \n, aceita HTML <br>
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
  "update_deal_fields",
  "Atualiza campos personalizados de um negócio. Passe um JSON com o nome do campo e o valor. Para campos enum, use o texto exato da opção. Para set (múltipla escolha), separe por vírgula. IMPORTANTE: Se um campo já tiver valor preenchido, a ferramenta NÃO vai sobrescrever — vai retornar os conflitos para você perguntar ao usuário. Use force=true SOMENTE após confirmação explícita do usuário.",
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
      const isEmpty = current === null || current === undefined || current === "";
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
    let msg = `Negócio ${deal_id} atualizado! Campos alterados: ${Object.keys(parsed).join(", ")}\nhttps://${COMPANY_DOMAIN}.pipedrive.com/deal/${deal_id}`;
    if (force && conflicts.length > 0) {
      msg += `\n(${conflicts.length} campo(s) sobrescrito(s) com confirmação do usuário: ${conflicts.map((c) => `"${c.field}"`).join(", ")})`;
    }
    if (errors.length > 0) msg += `\n\nAvisos:\n${errors.join("\n")}`;
    return { content: [{ type: "text", text: msg }] };
  }
);

// ─── SINCRONIZAÇÃO ────────────────────────────────────────────────────────────

// Função interna: monta e salva config.js unificado
function saveConfig(config) {
  const lines = [
    "// Configuração unificada do Pipedrive MCP — gerada por sync_all",
    `// Sincronizado em ${config.synced_at}`,
    "// Distribuir este arquivo para funcionários que não têm permissão de sync",
    "",
    "export const CONFIG = " + JSON.stringify(config, null, 2) + ";",
    "",
  ];
  fs.writeFileSync(CONFIG_PATH, lines.join("\n"), "utf-8");
}

// Função interna: carrega config existente (para preservar aliases de activity_types)
async function loadExistingConfig() {
  try {
    const mod = await import(new URL("./config.js", import.meta.url).href + "?t=" + Date.now());
    return mod.CONFIG || {};
  } catch (_) {
    return {};
  }
}

server.tool(
  "sync_all",
  "Sincroniza TUDO do Pipedrive em um único config.js: campos de deals, campos de contatos, tipos de atividade, pipelines, etapas, usuários e domínio. Execute após instalar o MCP pela primeira vez ou quando alterar configurações no Pipedrive. O config.js gerado pode ser distribuído para funcionários.",
  {},
  async () => {
    try {
      const existing = await loadExistingConfig();
      const summary = [];
      const config = { synced_at: new Date().toISOString().split("T")[0] };

      // 1. Campos personalizados de DEALS
      const dealFieldsData = await pipedriveRequest("/dealFields?limit=500");
      const dealCustom = (dealFieldsData.data || []).filter((f) => /^[a-f0-9]{40}$/.test(f.key));
      const dealMapping = {};
      let dEnum = 0, dSet = 0, dOther = 0;
      for (const field of dealCustom) {
        const entry = { key: field.key, type: field.field_type };
        if ((field.field_type === "enum" || field.field_type === "set") && field.options) {
          entry.options = {};
          for (const opt of field.options) entry.options[opt.label] = opt.id;
          if (field.field_type === "enum") dEnum++; else dSet++;
        } else { dOther++; }
        dealMapping[field.name] = entry;
      }
      // Preservar descriptions e sections do config anterior
      const existingDealFields = existing.deal_custom_fields || {};
      for (const [name, entry] of Object.entries(dealMapping)) {
        const prev = existingDealFields[name];
        if (prev?.description) entry.description = prev.description;
        if (prev?.section) entry.section = prev.section;
      }
      config.deal_custom_fields = dealMapping;
      summary.push(`Campos de deals: ${dealCustom.length} (${dEnum} enum, ${dSet} set, ${dOther} outros)`);

      // 2. Campos personalizados de CONTATOS
      const personFieldsData = await pipedriveRequest("/personFields?limit=500");
      const personCustom = (personFieldsData.data || []).filter((f) => /^[a-f0-9]{40}$/.test(f.key));
      const personMapping = {};
      let pEnum = 0, pSet = 0, pOther = 0;
      for (const field of personCustom) {
        const entry = { key: field.key, type: field.field_type };
        if ((field.field_type === "enum" || field.field_type === "set") && field.options) {
          entry.options = {};
          for (const opt of field.options) entry.options[opt.label] = opt.id;
          if (field.field_type === "enum") pEnum++; else pSet++;
        } else { pOther++; }
        personMapping[field.name] = entry;
      }
      // Preservar descriptions do config anterior
      const existingPersonFields = existing.person_custom_fields || {};
      for (const [name, entry] of Object.entries(personMapping)) {
        const prev = existingPersonFields[name];
        if (prev?.description) entry.description = prev.description;
      }
      config.person_custom_fields = personMapping;
      summary.push(`Campos de contatos: ${personCustom.length} (${pEnum} enum, ${pSet} set, ${pOther} outros)`);

      // 3. Tipos de atividade (preserva aliases/durations do config anterior)
      const actData = await pipedriveRequest("/activityTypes");
      const existingTypes = existing.activity_types || {};
      const mergedTypes = {};
      for (const t of (actData.data || [])) {
        const key = t.key_string;
        const prev = existingTypes[key];
        mergedTypes[key] = {
          name: t.name,
          aliases: prev?.aliases || [t.name.toLowerCase()],
          default_duration: prev?.default_duration || null,
          is_custom: !!t.is_custom_flag,
          active: !!t.active_flag,
        };
      }
      // Tipos removidos da API → marcar inactive
      for (const [key, prev] of Object.entries(existingTypes)) {
        if (!mergedTypes[key]) mergedTypes[key] = { ...prev, active: false };
      }
      config.activity_types = mergedTypes;
      const activeCount = Object.values(mergedTypes).filter(t => t.active).length;
      summary.push(`Tipos de atividade: ${activeCount} ativos`);

      // 4. Pipelines + Etapas
      const pipData = await pipedriveRequest("/pipelines");
      const pipelines = [];
      for (const p of (pipData.data || [])) {
        const stData = await pipedriveRequest(`/stages?pipeline_id=${p.id}`);
        const stages = (stData.data || []).map(s => ({ id: s.id, name: s.name, order: s.order_nr }));
        pipelines.push({ id: p.id, name: p.name, stages });
      }
      config.pipelines = pipelines;
      summary.push(`Pipelines: ${pipelines.length} (${pipelines.reduce((sum, p) => sum + p.stages.length, 0)} etapas)`);

      // 5. Usuários
      const userData = await pipedriveRequest("/users?limit=500");
      config.users = (userData.data || []).filter(u => u.active_flag).map(u => ({ id: u.id, name: u.name }));
      summary.push(`Usuários: ${config.users.length} ativos`);

      // 6. Domínio da empresa
      const me = await pipedriveRequest("/users/me");
      config.company_domain = me.data?.company_domain || "app";

      // 7. Salvar config.js
      saveConfig(config);

      // 8. Atualizar memória imediatamente
      DEAL_CUSTOM_FIELDS = dealMapping; rebuildReverseMaps();
      PERSON_CUSTOM_FIELDS = personMapping; rebuildPersonReverseMaps();
      ACTIVITY_TYPES = mergedTypes; rebuildTypeLookup();
      PIPELINE_MAP = {}; STAGE_MAP = {}; STAGES_DATA = [];
      for (const p of pipelines) {
        PIPELINE_MAP[p.id] = p.name;
        for (const s of p.stages) {
          STAGE_MAP[s.id] = s.name;
          STAGES_DATA.push({ id: s.id, name: s.name, pipeline_id: p.id, order: s.order });
        }
      }
      ACTIVE_USERS = config.users;
      COMPANY_DOMAIN = config.company_domain;

      return {
        content: [{
          type: "text",
          text: [
            "config.js sincronizado!",
            "",
            ...summary,
            "",
            "Tudo carregado na memória — pronto para uso imediato.",
            "Distribua config.js para funcionários que não têm permissão de sync.",
          ].join("\n"),
        }],
      };
    } catch (err) {
      return {
        content: [{
          type: "text",
          text: `Erro ao sincronizar: ${err.message}\n\nVerifique:\n1. O token da API (PIPEDRIVE_API_KEY) é válido?\n2. O token tem permissão de admin?`,
        }],
      };
    }
  }
);

// ─── START ────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
