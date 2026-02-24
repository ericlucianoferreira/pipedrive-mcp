# Pipedrive MCP Server

MCP (Model Context Protocol) server para integração com o CRM Pipedrive. Permite que assistentes AI (Claude Code, Claude Desktop, etc.) interajam diretamente com o Pipedrive.

## Funcionalidades

- **Negócios**: listar, buscar, criar, atualizar, resumo, histórico
- **Contatos**: listar, buscar, criar, atualizar
- **Organizações**: buscar, criar, detalhes
- **Atividades**: listar, criar, atualizar
- **Notas**: criar, listar por negócio
- **Produtos**: listar, vincular a negócios
- **Campos personalizados**: listar, atualizar com proteção contra sobrescrita
- **Pipeline/Etapas**: listar pipelines e etapas
- **Paginação**: suporte a `start`/`limit` em todos os endpoints de listagem + `buscar_todos` para deals

## Instalação

```bash
git clone https://github.com/ericluciano/pipedrive-mcp.git
cd pipedrive-mcp
npm install
```

## Configuração

Cada usuário deve configurar seu próprio token da API do Pipedrive.

### 1. Obter o token

Acesse: **Pipedrive > Configurações > Dados pessoais > API** e copie seu token pessoal.

### 2. Configurar no Claude Code

Adicione ao seu arquivo de configuração MCP (`~/.claude/claude_desktop_config.json` ou equivalente):

```json
{
  "mcpServers": {
    "pipedrive": {
      "command": "node",
      "args": ["/caminho/para/pipedrive-mcp/index.js"],
      "env": {
        "PIPEDRIVE_API_KEY": "seu_token_aqui"
      }
    }
  }
}
```

### 3. Configurar via variável de ambiente (alternativa)

```bash
cp .env.example .env
# Edite .env e coloque seu token
```

```bash
PIPEDRIVE_API_KEY=seu_token_aqui node index.js
```

## Paginação

Todos os endpoints de listagem suportam paginação:

```
- limit: quantidade por página (padrão 100, máx 500)
- start: offset (padrão 0)
```

O retorno inclui metadados de paginação:

```json
{
  "dados": [...],
  "paginacao": {
    "inicio": 0,
    "total_nesta_pagina": 100,
    "mais_itens": true,
    "proximo_inicio": 100
  }
}
```

Para buscar **todos** os deals automaticamente, use `buscar_todos: true` (máx 5000 registros).

## Segurança

- O token **nunca** é commitado no repositório (`.env` está no `.gitignore`)
- Operações `DELETE` são bloqueadas por padrão
- Campos com valor existente não são sobrescritos sem confirmação explícita (`force: true`)

## Ferramentas disponíveis

| Ferramenta | Descrição |
|---|---|
| `list_deals` | Lista negócios com filtros e paginação |
| `search_deals` | Busca negócios por termo |
| `get_deal` | Detalhes de um negócio com campos personalizados |
| `create_deal` | Cria negócio com campos personalizados |
| `update_deal` | Atualiza status, etapa, valor |
| `get_deal_summary` | Resumo estatístico |
| `list_deal_history` | Histórico de alterações |
| `create_note` | Cria nota em negócio/contato/org |
| `list_deal_notes` | Lista notas de um negócio |
| `list_persons` | Lista contatos |
| `search_persons` | Busca contatos |
| `get_person` | Detalhes de um contato |
| `create_person` | Cria contato |
| `update_person` | Atualiza contato |
| `search_organizations` | Busca organizações |
| `get_organization` | Detalhes de uma organização |
| `create_organization` | Cria organização |
| `list_activities` | Lista atividades com filtros |
| `list_activity_types` | Lista tipos de atividade |
| `create_activity` | Cria atividade |
| `update_activity` | Atualiza atividade |
| `list_pipelines` | Lista pipelines |
| `list_stages` | Lista etapas de um pipeline |
| `list_users` | Lista usuários da equipe |
| `list_products` | Lista produtos |
| `add_product_to_deal` | Vincula produto a negócio |
| `list_deal_fields` | Lista campos personalizados |
| `update_deal_fields` | Atualiza campos personalizados |
