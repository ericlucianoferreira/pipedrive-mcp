# Pipedrive MCP Server v6.0.0

MCP (Model Context Protocol) server para integracao com o CRM Pipedrive. Permite que assistentes AI (Claude Code, Claude Desktop, etc.) interajam diretamente com o Pipedrive.

Funciona com **qualquer conta do Pipedrive** — cada usuario configura seu proprio token e sincroniza seus dados automaticamente.

> **Credenciais sao pessoais.** Cada pessoa usa seu proprio token de API do Pipedrive. Nenhuma credencial esta incluida neste repositorio.

## Funcionalidades

- **Negocios**: listar, buscar, criar, atualizar, fluxo de movimentacoes
- **Contatos**: buscar, criar, atualizar
- **Organizacoes**: buscar, criar, detalhes
- **Atividades**: listar, criar, atualizar, com aliases e duracoes padrao configuraveis
- **Notas**: criar, editar, listar por negocio
- **Produtos**: listar, vincular a negocios
- **Campos personalizados**: sincronizacao automatica, atualizar com protecao contra sobrescrita
- **config.js unificado**: todos os dados de referencia em um unico arquivo distribuivel
- **Resolucao por nome**: pipelines, etapas e usuarios podem ser passados por nome ou ID — o MCP resolve automaticamente via config.js
- **Paginacao**: suporte a `start`/`limit` em todos os endpoints de listagem + `buscar_todos` para deals
- **Dominio dinamico**: links de resposta usam o dominio da sua conta automaticamente
- **Fuso horario**: conversao automatica de horarios (configuravel via variavel de ambiente)
- **Visibilidade**: deals, contatos e organizacoes criados visiveis para toda a empresa

## Instalacao

```bash
git clone https://github.com/ericlucianoferreira/pipedrive-mcp.git
cd pipedrive-mcp
npm install
```

## Configuracao

Cada usuario deve configurar seu proprio token da API do Pipedrive.

### 1. Obter o token

Acesse: **Pipedrive > Configuracoes > Dados pessoais > API** e copie seu token pessoal.

### 2. Configurar no Claude Code

Adicione ao seu arquivo de configuracao MCP (`.claude/settings.json` ou `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "pipedrive": {
      "command": "node",
      "args": ["/caminho/para/pipedrive-mcp/index.js"],
      "env": {
        "PIPEDRIVE_API_KEY": "seu_token_aqui",
        "PIPEDRIVE_TIMEZONE": "America/Sao_Paulo"
      }
    }
  }
}
```

| Variavel | Obrigatoria | Descricao |
|----------|:-:|---|
| `PIPEDRIVE_API_KEY` | Sim | Token pessoal da API do Pipedrive |
| `PIPEDRIVE_TIMEZONE` | Nao | Fuso horario para conversao de horarios. Padrao: `America/Sao_Paulo` |

### 3. Sincronizar dados

Peca ao Claude:

```
"Execute sync_all do Pipedrive"
```

Isso gera o arquivo `config.js` com todos os dados de referencia:
- Campos personalizados de deals e contatos
- Tipos de atividade (com aliases e duracoes)
- Pipelines e etapas
- Usuarios ativos
- Dominio da empresa

### 4. Distribuicao para equipe (opcional)

Se membros da equipe nao tem permissao de admin no Pipedrive:
1. O admin executa `sync_all` na sua maquina
2. Copia o `config.js` gerado e envia para os membros
3. Cada membro coloca o `config.js` na pasta do MCP

O MCP carrega o `config.js` no startup e usa como fallback se a API estiver indisponivel.

## Arquivo config.js

Substitui os antigos `fields.js`, `person_fields.js` e `activity_types.js` em um unico arquivo.

| Aspecto | Descricao |
|---------|-----------|
| **Gerado por** | `sync_all` (automatico via API) |
| **Conteudo** | Campos de deals, campos de contatos, tipos de atividade, pipelines, etapas, usuarios, dominio |
| **No .gitignore** | Sim (dados especificos da conta, nao sobe pro GitHub) |
| **Distribuivel** | Sim — copie para funcionarios que nao tem permissao de sync |
| **Quando resincronizar** | Ao criar campos, alterar pipelines, adicionar usuarios, etc. |

## Campos personalizados

O MCP traduz automaticamente os hashes do Pipedrive para nomes legiveis.

- **`get_deal`** — traduz hashes para nomes (ex: `cb145b...` vira `"Segmento"`)
- **`create_deal`** / **`update_deal_fields`** — aceita nomes legiveis e converte para o formato da API
- **Protecao contra sobrescrita**: campos com valor existente nao sao sobrescritos sem `force: true`

## Tipos de atividade

- O MCP aceita **key da API**, **nome** ou **alias** ao criar/atualizar atividades
- Aliases e duracoes padrao sao preservados ao resincronizar
- Edite diretamente no `config.js` ou peca ao Claude

## Seguranca

- Token **nunca** commitado no repositorio
- `config.js` (dados da conta) no `.gitignore`
- Operacoes `DELETE` bloqueadas por padrao
- Campos com valor existente protegidos contra sobrescrita
- Dominio da empresa detectado automaticamente
- Contatos e organizacoes criados com visibilidade para toda a empresa

### Guardrails anti-duplicata

| Operacao | Verificacao automatica |
|----------|----------------------|
| `create_person` | Busca por ultimos 8 digitos do telefone + email |
| `create_deal` | Busca deals abertos para o `person_id` |
| `create_organization` | Busca organizacoes por nome |
| `create_activity` | Busca atividades pendentes do deal/pessoa |
| `update_person` | Verifica conflitos antes de sobrescrever |
| `update_deal_fields` | Verifica conflitos em campos customizados |

## Ferramentas disponiveis (24 tools)

### Sincronizacao

| Ferramenta | Descricao |
|---|---|
| `sync_all` | Sincroniza TUDO em um unico config.js (campos, atividades, pipelines, usuarios) |

### Negocios

| Ferramenta | Descricao |
|---|---|
| `list_deals` | Lista negocios com filtros por status, pipeline, etapa, responsavel |
| `search_deals` | Busca negocios por termo |
| `get_deal` | Detalhes completos com campos legiveis |
| `create_deal` | Cria negocio com campos personalizados |
| `update_deal` | Atualiza status, etapa, valor, responsavel |
| `get_deal_flow` | Historico de movimentacoes de status e etapa |
| `update_deal_fields` | Atualiza campos personalizados com protecao |

### Contatos

| Ferramenta | Descricao |
|---|---|
| `search_persons` | Busca contatos por nome, email ou telefone |
| `get_person` | Detalhes completos de um contato |
| `create_person` | Cria contato (visivel para toda empresa) |
| `update_person` | Atualiza nome, email, telefone, organizacao |

### Organizacoes

| Ferramenta | Descricao |
|---|---|
| `search_organizations` | Busca organizacoes por nome |
| `get_organization` | Detalhes completos |
| `create_organization` | Cria organizacao (visivel para toda empresa) |

### Atividades

| Ferramenta | Descricao |
|---|---|
| `list_activities` | Lista atividades com filtros por tipo, usuario, periodo |
| `list_deal_activities` | Lista todas as atividades de um negocio |
| `create_activity` | Cria atividade com alias e duracao configuravel |
| `update_activity` | Atualiza atividade (remarcar, concluir, mudar tipo) |

### Notas

| Ferramenta | Descricao |
|---|---|
| `create_note` | Cria nota em negocio, contato ou organizacao |
| `update_note` | Edita nota existente ou pina/despina |
| `list_deal_notes` | Lista notas de um negocio |

### Produtos

| Ferramenta | Descricao |
|---|---|
| `list_products` | Lista produtos disponiveis |
| `add_product_to_deal` | Vincula produto a negocio com preco e quantidade |
