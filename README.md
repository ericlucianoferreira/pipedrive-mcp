# Pipedrive MCP Server

MCP (Model Context Protocol) server para integração com o CRM Pipedrive. Permite que assistentes AI (Claude Code, Claude Desktop, etc.) interajam diretamente com o Pipedrive.

Funciona com **qualquer conta do Pipedrive** — cada usuário configura seu próprio token e sincroniza seus campos personalizados automaticamente.

## Funcionalidades

- **Negócios**: listar, buscar, criar, atualizar, resumo, histórico
- **Contatos**: listar, buscar, criar, atualizar
- **Organizações**: buscar, criar, detalhes
- **Atividades**: listar, criar, atualizar
- **Notas**: criar, listar por negócio
- **Produtos**: listar, vincular a negócios
- **Campos personalizados**: sincronização automática, listar, atualizar com proteção contra sobrescrita
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

### 4. Onboarding guiado

Após configurar o token, peça ao Claude para iniciar o onboarding. Ele vai guiar você por 3 passos:

```
"Inicie o onboarding do Pipedrive MCP"
```

O onboarding vai:
1. **Sincronizar campos** — mapeia automaticamente os campos personalizados da sua conta
2. **Mostrar sua estrutura** — exibe campos, pipelines, etapas e tipos de atividade
3. **Configurar regras de negócio** — você explica suas regras e o Claude gera o CLAUDE.md

Pronto! O MCP está configurado e pronto para uso.

## Campos personalizados

Cada conta do Pipedrive tem campos personalizados diferentes (com hashes e IDs únicos). O `sync_fields` resolve isso automaticamente.

### Como funciona

1. **`sync_fields`** — busca todos os campos personalizados da sua conta via API e gera o arquivo `fields.js` local
2. **`get_deal`** — traduz os hashes internos para nomes legíveis (ex: `cb145b...` vira `"Segmento"`)
3. **`create_deal`** / **`update_deal_fields`** — aceita nomes legíveis e converte para o formato da API
4. **`list_deal_fields`** — lista todos os campos disponíveis com suas opções

### Quando resincronizar

Execute `sync_fields` novamente quando:
- Criar novos campos personalizados no Pipedrive
- Alterar opções de campos enum/set
- Renomear campos existentes

### Proteção contra sobrescrita

Ao atualizar campos com `update_deal_fields`, campos que já têm valor preenchido **não são sobrescritos** por padrão. O MCP retorna os conflitos para confirmação. Use `force: true` somente após confirmação explícita.

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

## Regras de negócio (CLAUDE.md)

O MCP cuida da parte **técnica** (comunicação com a API). Para que o agente AI siga as regras do seu processo comercial, você precisa configurar um arquivo `CLAUDE.md` com suas regras de negócio.

### O que incluir no CLAUDE.md

- Etapas do pipeline com critérios de movimentação
- Campos obrigatórios por etapa
- Motivos de perda e regras de reativação
- Produtos/serviços com preços e regras comerciais
- Tipos de atividade padronizados
- ICP (Perfil Ideal do Cliente)
- Regras de comportamento do agente (criar deal, mover, perder, etc.)

### Como usar

1. Copie o template `CLAUDE.md.example` incluído neste repositório
2. Preencha com as regras específicas da sua empresa
3. Configure como:
   - **Claude Code:** salve como `CLAUDE.md` na raiz do projeto ou em `~/.claude/CLAUDE.md`
   - **Claude Desktop / Cloud Coworking:** adicione como arquivo de memória/contexto

### fields.js vs CLAUDE.md

| | `fields.js` | `CLAUDE.md` |
|---|---|---|
| Para quem | Para o **código** do MCP | Para a **IA** (Claude) |
| O que contém | Mapeamento técnico de hashes | Regras de negócio |
| Como gera | `sync_fields` (automático) | Você escreve manualmente |
| Sem ele | Campos aparecem como hashes | MCP funciona, mas IA não segue suas regras |

## Segurança

- O token **nunca** é commitado no repositório (`.env` está no `.gitignore`)
- `fields.js` (dados da conta) também está no `.gitignore`
- Operações `DELETE` são bloqueadas por padrão
- Campos com valor existente não são sobrescritos sem confirmação explícita (`force: true`)

## Ferramentas disponíveis

| Ferramenta | Descrição |
|---|---|
| `onboarding` | Guia de configuração inicial — executa na primeira vez para setup completo |
| `sync_fields` | Sincroniza campos personalizados da conta |
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
| `list_deal_fields` | Lista campos personalizados mapeados |
| `update_deal_fields` | Atualiza campos personalizados |
