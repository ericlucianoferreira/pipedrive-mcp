# 🐛 Bug Log — pipedrive-mcp | 27/02/2026

**Repositório:** `github.com/ericluciano/pipedrive-mcp`  
**Task ClickUp:** https://app.clickup.com/t/86aft9mkd

---

## Bug #1 — Timezone UTC vs America/Sao_Paulo
**Status:** ✅ Corrigido — commit `c1aef6d`

O MCP enviava `due_time` como horário local (Brasília) direto para a API do Pipedrive, que armazena em UTC. A diferença de -3h fazia todas as atividades chegarem com 3 horas a menos. 56 atividades do dia 27/02 foram corrigidas manualmente.

**Correção:** Adicionadas as funções `localToUtc()`, `utcToLocal()` e `getTzOffsetMinutes()` no `index.js`. Timezone configurável via `PIPEDRIVE_TIMEZONE` (padrão: `America/Sao_Paulo`). Aplicado no `create_activity`, `update_activity` e nas 3 funções de listagem.

---

## Bug #2 — `update_activity` não expõe campo `deal_id`
**Status:** ✅ Corrigido — 27/02/2026

Ao atualizar uma atividade existente, não era possível vincular ou alterar o deal associado — o campo `deal_id` não estava exposto no handler. Resultado: atividade do Marcos Bueno (ID 33073) ficou sem vínculo com o deal.

**Correção:** Adicionado `deal_id` opcional no schema e no body do `update_activity`. Também adicionado `recurso_de_ia` ao enum de tipos (estava faltando).

---

## Bug #3 — `create_note` sem guard de parâmetros obrigatórios
**Status:** ✅ Corrigido — 27/02/2026

Tool `create_note` era invocada acidentalmente sem argumentos, gerando erro MCP -32602 e interrompendo o fluxo.

**Correção:** Adicionadas validações explícitas no handler: `content` não pode ser vazio, e pelo menos um vínculo (`deal_id`, `person_id` ou `org_id`) deve ser informado. Retorna mensagem de erro clara sem chamar a API.

---

## Bug #4 — Atividade reutilizada sem verificar `deal_id`
**Status:** 🔧 Pendente

Ao criar atividade para Marcos Bueno às 12h30, o agente atualizou uma atividade antiga em atraso (ID 33073) sem `deal_id`, em vez de criar uma nova. Histórico sobrescrito e atividade ficou desvinculada do deal.

**Correção sugerida:** Antes de reutilizar uma atividade existente, verificar se ela tem `deal_id`. Se não tiver e o contexto exigir vínculo com deal, criar nova.

---

## Bug #5 — `git diff` rodado fora do repositório
**Status:** ✅ Corrigido (operacional)

Comando `git diff` foi executado na pasta pai `MCPs e Skills/` que não é um repositório git. Correção: sempre rodar dentro de `pipedrive-mcp/`.

---

---

## Bug #6 — `create_deal` sem `visible_to` — visibilidade incorreta
**Status:** ✅ Corrigido — 27/02/2026

Deals criados pelo MCP ficavam com visibilidade padrão da conta (proprietário ou time do proprietário), em vez de visíveis para toda a empresa. Causava deals "sumidos" para outros usuários no Claude Desktop.

**Correção:** Adicionado `visible_to: 3` (empresa inteira) fixo no body do `create_deal`.

---

---

## Bug #7 — `recurso_de_ia` faltando nos enums de `create_activity` e `list_activities`
**Status:** ✅ Corrigido — 27/02/2026

O tipo `recurso_de_ia` estava no `update_activity` (corrigido no Bug #2) mas faltava nos tools `create_activity` e `list_activities`. Qualquer tentativa de criar ou filtrar atividades desse tipo gerava erro de validação Zod.

**Correção:** Adicionado `recurso_de_ia` ao enum dos dois tools.

---

## Bug #8 — Links clicáveis ausentes nas respostas de criação/atualização
**Status:** ✅ Corrigido — 27/02/2026

`create_deal`, `update_deal`, `create_activity`, `create_note` e `create_person` não retornavam o link do Pipedrive na resposta. Regra do CLAUDE.md: "Sempre incluir link clicável do deal, pessoa ou task ao exibir qualquer atualização, resumo ou relatório."

**Correção:** Adicionados links `https://expertintegrado.pipedrive.com/deal/{id}` e `/person/{id}` nas respostas de todos os tools de criação/atualização.

---

## Bug #9 — Nomenclatura incorreta dos tipos de atividade na descrição do `create_activity`
**Status:** ✅ Corrigido — 27/02/2026

A descrição do tool usava nomes antigos ("Reunião inicial" / "Reunião de Apresentação") que conflitam com os nomes corretos definidos no CLAUDE.md ("Demonstração" e "Reunião Geral"). Isso confundia o modelo na hora de escolher o tipo certo.

**Correção:** Descrição atualizada com os nomes corretos: `diagnostico` = Demonstração, `apresentacao` = Reunião Geral, `recurso_de_ia` = Recurso de IA.

---

---

## Bug #10 — Quebras de linha `\n` ignoradas no campo `note` de atividades
**Status:** ✅ Corrigido — 27/02/2026
**ClickUp:** https://app.clickup.com/t/86afta924

A API do Pipedrive ignora `\n` no campo `note` de atividades — o campo aceita HTML. Notas enviadas com `\n` chegavam como texto colado, sem formatação.

**Comportamento confirmado:**
- Campo `note` de atividade → aceita `<br>`, ignora `\n`
- Campo `content` de nota standalone (`create_note`) → aceita `\n` normalmente

**Correção:** Adicionada função helper `formatActivityNote(text)` que converte `\n` → `<br>`. Aplicada em `create_activity` e `update_activity` antes de montar o body.

---

---

## Bug #11 — `list_deals` e `get_deal` retornam etapa/pipeline como IDs numéricos
**Status:** ✅ Corrigido — v5.4.0

`etapa_id` e `pipeline_id` chegavam como números para o modelo (ex: `14`, `300`), violando a regra do CLAUDE.md: "NUNCA exibir IDs numéricos de etapa, pipeline ou campos enum."

**Correção:** Cache `STAGE_MAP` e `PIPELINE_MAP` carregados na inicialização via `/pipelines` e `/stages`. Campos `etapa` e `pipeline` agora retornam nomes legíveis em `list_deals`, `mapDeal` e `translateDealFields`. Fallback para ID numérico se cache não estiver disponível.

---

## Bug #12 — `create_deal` sem `user_id` — impossível definir responsável
**Status:** ✅ Corrigido — v5.4.0

Não era possível criar deal já atribuído a outro vendedor; sempre caía no dono do token da API.

**Correção:** Adicionado parâmetro `user_id` opcional no schema e body do `create_deal`.

---

## Bug #13 — `update_deal` sem `user_id` — impossível transferir responsável
**Status:** ✅ Corrigido — v5.4.0

Não era possível transferir responsável de um deal existente via MCP.

**Correção:** Adicionado parâmetro `user_id` opcional no schema e body do `update_deal`.

---

## Bug #14 — `due_date` obrigatório em `create_activity` forçava inventar data
**Status:** ✅ Corrigido — v5.4.0

Campo `due_date` era obrigatório no schema Zod, forçando o modelo a inventar uma data para atividades do tipo `task` ou `recurso_de_ia` sem prazo definido. A API do Pipedrive aceita atividades sem data.

**Correção:** `due_date` tornado opcional no schema. Handler já usava `if (due_date)` para o body — sem alteração necessária no handler.

---

---

## Bug #15 — `get_deal_flow` retorna IDs numéricos para mudanças de etapa
**Status:** ✅ Corrigido — v5.4.1

`de_id`/`para_id` retornavam números (ex: `14` → `18`) em vez de nomes legíveis. Inconsistente com `translateDealFields`.

**Correção:** Substituído por `de`/`para` usando `STAGE_MAP` com fallback para ID numérico.

---

## Bug #16 — `list_activities`, `list_deal_activities`, `list_activities` retornam key da API como tipo
**Status:** ✅ Corrigido — v5.4.1

Campo `tipo` retornava a key da API (`diagnostico`, `call`) em vez do nome amigável definido no CLAUDE.md. Modelo via "diagnostico" em vez de "Demonstração".

**Correção:** Adicionado `ACTIVITY_TYPE_NAMES` (mapa key → nome amigável) aplicado nos 3 tools de listagem de atividades.

---

---

## Bug #17 — `search_deals` retorna etapa/pipeline como IDs numéricos
**Status:** ✅ Corrigido — v5.4.2

Inconsistente com `list_deals` que já traduzia. `search_deals` retornava `stage_id`/`pipeline_id` como números.

**Correção:** Adicionados `etapa: STAGE_MAP[...]` e `pipeline: PIPELINE_MAP[...]` no mapa de resposta.

---

## Bug #18 — `update_deal` aceita qualquer string em `lost_reason`
**Status:** ✅ Corrigido — v5.4.2

Schema aceitava qualquer texto livre, permitindo motivos de perda fora do padrão definido no CLAUDE.md.

**Correção:** Substituído `z.string()` por `z.enum([...8 motivos padronizados...])`.

---

## Bug #19 — `translateDealFields` não retorna `person_id`, `org_id` e `owner_id`
**Status:** ✅ Corrigido — v5.4.2

Após `get_deal`, o modelo não tinha os IDs de pessoa, organização e responsável — forçando buscas extras.

**Correção:** Adicionados `contato_id`, `empresa_id` e `responsavel_id` na resposta de `translateDealFields`.

---

## Bug #20 — `create_organization` sem link clicável
**Status:** ✅ Corrigido — v5.4.2

Única tool de criação sem link clicável, violando regra do CLAUDE.md.

**Correção:** Adicionado `https://expertintegrado.pipedrive.com/organization/{id}` na resposta.

---

## Bug #21 — `update_deal_fields` trata `0` como campo vazio
**Status:** ✅ Corrigido — v5.4.2

`isEmpty` incluía `current === 0`, fazendo com que campos numéricos com valor zero (ex: "Tamanho da equipe comercial" = 0) fossem sobrescritos indevidamente.

**Correção:** Removido `|| current === 0` da condição de isEmpty.

---

## Bug #22 — `update_deal_fields` com `force=true` não listava quais campos foram sobrescritos
**Status:** ✅ Corrigido — v5.4.2

Mensagem dizia apenas "X campo(s) sobrescrito(s)" sem especificar quais.

**Correção:** Adicionado lista dos campos sobrescritos na mensagem de confirmação.

---

## Bug #23 — `list_activity_types` retornava key da API em vez do nome amigável
**Status:** ✅ Corrigido — v5.4.2

Campo `nome` usava `t.name` (dado da API) em vez do mapa `ACTIVITY_TYPE_NAMES`.

**Correção:** `nome: ACTIVITY_TYPE_NAMES[t.key_string] || t.name`.

---

## Bug #24 — `create_person` e `create_organization` sem `visible_to`
**Status:** Corrigido — v5.5.0

Mesmo bug do #6 (deals), mas para contatos e organizacoes. Registros criados ficavam visiveis apenas para o dono do token.

**Correcao:** Adicionado `visible_to: 3` (empresa inteira) no body de `create_person` e `create_organization`.

---

## Bug #25 — Timezone double-offset no `localToUtc`
**Status:** Corrigido — v5.5.0

`new Date("2026-03-05T14:00:00")` sem sufixo `Z` era interpretado como horario local pelo JS (UTC-3), e depois a funcao somava mais +3h de offset. Resultado: atividade criada para 14h aparecia as 20h no Pipedrive (+6h total).

**Correcao:** Adicionado `Z` no construtor: `new Date("...T14:00:00Z")` forca interpretacao como UTC antes de aplicar o offset.

---

## Bug #26 — Tipos de atividade hardcoded impedem uso multi-empresa
**Status:** Corrigido — v5.5.0

`ACTIVITY_TYPE_NAMES` e `z.enum` tinham 12 tipos fixos da Expert Integrado. Outras empresas com tipos diferentes recebiam erro de validacao Zod.

**Correcao:** Removido hardcode. Novo sistema `activity_types.js` com `sync_activity_types` (sync automatico), aliases configuraveis, duracoes padrao por tipo, e `z.string()` em vez de `z.enum()`.

---

## Bug #27 — Links hardcoded com "expertintegrado.pipedrive.com"
**Status:** Corrigido — v5.5.0

6 ocorrencias de `expertintegrado.pipedrive.com` nos links de resposta dos tools de criacao/atualizacao. Outras empresas viam links para o dominio errado.

**Correcao:** Variavel `COMPANY_DOMAIN` carregada via `/users/me` no startup. Todos os links usam template dinamico `${COMPANY_DOMAIN}.pipedrive.com`.

---

## Bug #28 — `create_person` sem verificacao de duplicatas
**Status:** Corrigido — v5.6.0

Ao pedir para cadastrar alguem, o MCP criava direto sem verificar se a pessoa ja existia. Resultado: contatos duplicados no CRM.

**Correcao:** Guardrail no handler `create_person`: antes de criar, busca por ultimos 8 digitos do telefone (ignorando DDD e 9o digito WhatsApp) e/ou email via `/persons/search`. Se encontrar match, retorna aviso com link em vez de criar. Parametro `force: true` permite criar apos confirmacao explicita.

---

## Bug #29 — `create_deal` sem verificacao de deals abertos existentes
**Status:** Corrigido — v5.6.0

Ao criar deal para um contato, o MCP nao verificava se ja existia deal aberto vinculado aquela pessoa. Resultado: deals duplicados para o mesmo prospect.

**Correcao:** Guardrail no handler `create_deal`: se `person_id` informado, busca deals abertos via `/persons/{id}/deals?status=open`. Se encontrar, retorna aviso com links dos deals existentes. Parametro `force: true` permite criar apos confirmacao explicita.

---

## Bug #30 — `update_person` sobrescreve campos sem avisar
**Status:** Corrigido — v5.6.0

Ao atualizar contato, campos como nome e organizacao eram sobrescritos sem aviso previo. Emails e telefones ja eram adicionados (nao substituidos), mas nome e org eram silenciosamente substituidos.

**Correcao:** Guardrail no handler `update_person`: antes de atualizar, verifica se campos (nome, org) ja tem valor preenchido. Se houver conflito, retorna aviso com valores atuais vs novos. Parametro `force: true` permite sobrescrever apos confirmacao explicita. Emails e telefones continuam sendo adicionados (nunca substituidos).

---

## Bug #31 — `create_organization` sem verificacao de duplicatas
**Status:** Corrigido — v5.6.0

Ao criar organizacao, o MCP nao verificava se ja existia empresa com nome similar. Resultado: organizacoes duplicadas no CRM.

**Correcao:** Guardrail no handler `create_organization`: antes de criar, busca por nome via `/organizations/search`. Se encontrar match, retorna aviso com link. Parametro `force: true` permite criar apos confirmacao explicita.

---

## Bug #32 — `create_activity` sem verificacao de atividades duplicadas
**Status:** Corrigido — v5.6.0

Ao criar atividade vinculada a deal ou pessoa, o MCP nao verificava se ja existia qualquer atividade pendente. Resultado: atividades duplicadas e acumulo de atividades em aberto (o padrao e ter apenas uma atividade pendente por vez).

**Correcao:** Guardrail no handler `create_activity`: se `deal_id` ou `person_id` informado, busca QUALQUER atividade pendente (done=0) vinculada. Se encontrar, retorna aviso com lista completa. Parametro `force: true` permite criar apos confirmacao explicita.

---

## Proximos passos
- [ ] Documentar regra: verificar `deal_id` antes de reutilizar atividade
