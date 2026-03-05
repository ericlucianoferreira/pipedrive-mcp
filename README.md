# Pipedrive MCP Server

MCP (Model Context Protocol) server para integracao com o CRM Pipedrive. Permite que assistentes AI (Claude Code, Claude Desktop, etc.) interajam diretamente com o Pipedrive.

Funciona com **qualquer conta do Pipedrive** — cada usuario configura seu proprio token e sincroniza seus campos e tipos de atividade automaticamente.

> **Credenciais sao pessoais.** Cada pessoa usa seu proprio token de API do Pipedrive. Nenhuma credencial esta incluida neste repositorio.

## Funcionalidades

- **Negocios**: listar, buscar, criar, atualizar, resumo, historico, fluxo de movimentacoes
- **Contatos**: listar, buscar, criar, atualizar
- **Organizacoes**: buscar, criar, detalhes
- **Atividades**: listar, criar, atualizar, com aliases e duracoes padrao configuraveis
- **Notas**: criar, editar, listar por negocio
- **Produtos**: listar, vincular a negocios
- **Campos personalizados**: sincronizacao automatica, listar, atualizar com protecao contra sobrescrita
- **Tipos de atividade**: sincronizacao automatica, aliases configuraveis, duracoes padrao por tipo
- **Pipeline/Etapas**: listar pipelines e etapas
- **Paginacao**: suporte a `start`/`limit` em todos os endpoints de listagem + `buscar_todos` para deals
- **Dominio dinamico**: links de resposta usam o dominio da sua conta automaticamente
- **Fuso horario**: conversao automatica de horarios (configuravel via variavel de ambiente)
- **Visibilidade**: deals, contatos e organizacoes criados visiveis para toda a empresa

## Instalacao

```bash
git clone https://github.com/ericluciano/pipedrive-mcp.git
cd pipedrive-mcp
npm install
```

## Configuracao

Cada usuario deve configurar seu proprio token da API do Pipedrive.

### 1. Obter o token

Acesse: **Pipedrive > Configuracoes > Dados pessoais > API** e copie seu token pessoal.

### 2. Configurar no Claude Code / Claude Desktop

Adicione ao seu arquivo de configuracao MCP (`claude_desktop_config.json` ou equivalente):

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

### 3. Configurar via variavel de ambiente (alternativa)

```bash
cp .env.example .env
# Edite .env e coloque seu token e timezone
```

### 4. Onboarding guiado

Apos configurar o token, peca ao Claude para iniciar o onboarding:

```
"Inicie o onboarding do Pipedrive MCP"
```

O onboarding guia voce por 3 passos:
1. **Sincronizar dados** — executa `sync_fields` (campos personalizados) e `sync_activity_types` (tipos de atividade)
2. **Mostrar sua estrutura** — exibe campos, pipelines, etapas e tipos de atividade com aliases
3. **Configurar regras de negocio** — voce explica suas regras e o Claude gera o CLAUDE.md

Pronto! O MCP esta configurado e pronto para uso.

## Campos personalizados

Cada conta do Pipedrive tem campos personalizados diferentes (com hashes e IDs unicos). O `sync_fields` resolve isso automaticamente.

### Como funciona

1. **`sync_fields`** — busca todos os campos personalizados da sua conta via API e gera o arquivo `fields.js` local
2. **`get_deal`** — traduz os hashes internos para nomes legiveis (ex: `cb145b...` vira `"Segmento"`)
3. **`create_deal`** / **`update_deal_fields`** — aceita nomes legiveis e converte para o formato da API
4. **`list_deal_fields`** — lista todos os campos disponiveis com suas opcoes

### Quando resincronizar

Execute `sync_fields` novamente quando:
- Criar novos campos personalizados no Pipedrive
- Alterar opcoes de campos enum/set
- Renomear campos existentes

### Protecao contra sobrescrita

Ao atualizar campos com `update_deal_fields`, campos que ja tem valor preenchido **nao sao sobrescritos** por padrao. O MCP retorna os conflitos para confirmacao. Use `force: true` somente apos confirmacao explicita.

## Tipos de atividade

Cada empresa tem tipos de atividade diferentes no Pipedrive. O MCP se adapta automaticamente a qualquer configuracao.

### Como funciona

1. **`sync_activity_types`** — busca os tipos da sua conta e gera `activity_types.js` local
2. O MCP aceita **key da API**, **nome** ou **alias** ao criar/atualizar atividades
3. Duracoes padrao podem ser configuradas por tipo

### Aliases

Voce pode configurar nomes alternativos para cada tipo de atividade. Por exemplo, o tipo `call` (key da API) pode ter os aliases `ligacao`, `chamada`, `telefone`. Quando alguem diz "crie uma ligacao", o MCP resolve automaticamente para o tipo correto.

### Duracoes padrao

Cada tipo pode ter uma duracao padrao. Se voce configura `call` com duracao de 15 minutos, toda ligacao criada sem especificar duracao tera 15 minutos automaticamente.

### Configurando aliases e duracoes

Apos rodar `sync_activity_types`, edite o arquivo `activity_types.js` gerado:

```js
export const ACTIVITY_TYPES = {
  "call": {
    "name": "Chamada",
    "aliases": ["ligacao", "chamada"],     // adicione aliases aqui
    "default_duration": 15,                 // duracao em minutos
    "is_custom": false,
    "active": true
  }
};
```

Ou peca ao Claude:
```
"Configure o tipo call com alias ligacao e duracao 15 minutos"
```

### Quando resincronizar

Execute `sync_activity_types` novamente quando:
- Criar novos tipos de atividade no Pipedrive
- Renomear tipos existentes
- Ativar/desativar tipos

> **Importante:** O re-sync **preserva** aliases e duracoes que voce configurou. Apenas os dados da API (nome, status) sao atualizados.

## Arquivos de configuracao por conta

O MCP gera arquivos locais especificos da sua conta. Esses arquivos **nao sobem para o GitHub** (estao no `.gitignore`).

| | `fields.js` | `activity_types.js` | `CLAUDE.md` |
|---|---|---|---|
| **Para quem** | Codigo do MCP | Codigo do MCP | IA (Claude) |
| **O que contem** | Mapeamento de campos | Tipos de atividade | Regras de negocio |
| **Como gera** | `sync_fields` (automatico) | `sync_activity_types` (automatico) | Voce escreve ou o Claude gera |
| **Sem ele** | Campos aparecem como hashes | Tipos sem aliases/duracoes | MCP funciona, mas IA nao segue suas regras |

## Paginacao

Todos os endpoints de listagem suportam paginacao:

```
- limit: quantidade por pagina (padrao 100, max 500)
- start: offset (padrao 0)
```

O retorno inclui metadados de paginacao:

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

Para buscar **todos** os deals automaticamente, use `buscar_todos: true` (max 5000 registros).

## Regras de negocio (CLAUDE.md)

O MCP cuida da parte **tecnica** (comunicacao com a API). Para que o agente AI siga as regras do seu processo comercial, voce precisa configurar um arquivo `CLAUDE.md` com suas regras de negocio.

### O que incluir no CLAUDE.md

- Etapas do pipeline com criterios de movimentacao
- Campos obrigatorios por etapa
- Motivos de perda e regras de reativacao
- Produtos/servicos com precos e regras comerciais
- Tipos de atividade com aliases e duracoes
- ICP (Perfil Ideal do Cliente)
- Regras de comportamento do agente (criar deal, mover, perder, etc.)

### Como usar

1. Copie o template `CLAUDE.md.example` incluido neste repositorio
2. Preencha com as regras especificas da sua empresa
3. Configure como:
   - **Claude Code:** salve como `CLAUDE.md` na raiz do projeto ou em `~/.claude/CLAUDE.md`
   - **Claude Desktop / Cloud Coworking:** adicione como arquivo de memoria/contexto

## Seguranca

- O token **nunca** e commitado no repositorio (`.env` esta no `.gitignore`)
- `fields.js` e `activity_types.js` (dados da conta) tambem estao no `.gitignore`
- Operacoes `DELETE` sao bloqueadas por padrao
- Campos com valor existente nao sao sobrescritos sem confirmacao explicita (`force: true`)
- Dominio da empresa e detectado automaticamente via API (sem hardcode)
- Contatos e organizacoes criados com visibilidade para toda a empresa (`visible_to: 3`)

### Guardrails anti-duplicata (v5.6.0)

Regras de protecao embutidas no MCP (nao dependem de configuracao do usuario):

| Operacao | Verificacao automatica | Comportamento |
|----------|----------------------|---------------|
| `create_person` | Busca por ultimos 8 digitos do telefone + email | Se encontrar match, retorna aviso com link. Parametro `force: true` para criar mesmo assim. |
| `create_deal` | Busca deals abertos para o `person_id` | Se encontrar deal aberto, retorna aviso com link. Parametro `force: true` para criar mesmo assim. |
| `create_organization` | Busca organizacoes por nome | Se encontrar nome similar, retorna aviso com link. Parametro `force: true` para criar mesmo assim. |
| `create_activity` | Busca atividades pendentes do mesmo tipo + mesma data | Se encontrar similar vinculada ao deal/pessoa, retorna aviso. Parametro `force: true` para criar mesmo assim. |
| `update_person` | Verifica se nome/org ja tem valor preenchido | Se houver conflito, retorna aviso antes de sobrescrever. Parametro `force: true` para confirmar. |
| `update_deal_fields` | Verifica se campos customizados ja tem valor | Se houver conflito, retorna lista de conflitos. Parametro `force: true` para sobrescrever. |

**Por que ultimos 8 digitos?** O padrao de busca por telefone usa apenas os 8 ultimos digitos para tolerar erros de DDD e o 9o digito adicionado em numeros WhatsApp brasileiros.

## Ferramentas disponiveis (34 tools)

### Configuracao

| Ferramenta | Descricao |
|---|---|
| `onboarding` | Guia de configuracao inicial — executa na primeira vez para setup completo |
| `sync_fields` | Sincroniza campos personalizados da conta |
| `sync_activity_types` | Sincroniza tipos de atividade com aliases e duracoes configuraveis |

### Negocios

| Ferramenta | Descricao |
|---|---|
| `list_deals` | Lista negocios com filtros por status, pipeline, etapa, responsavel e paginacao |
| `search_deals` | Busca negocios por termo (titulo, contato, empresa) |
| `get_deal` | Detalhes completos de um negocio com campos personalizados legiveis |
| `create_deal` | Cria negocio com campos personalizados |
| `update_deal` | Atualiza status, etapa, valor, responsavel |
| `get_deal_summary` | Resumo estatistico (valores totais e contagens por status) |
| `list_deal_history` | Historico de alteracoes de campos |
| `get_deal_flow` | Historico de movimentacoes de status e etapa com timestamps |
| `list_deal_fields` | Lista campos personalizados mapeados com opcoes |
| `update_deal_fields` | Atualiza campos personalizados com protecao contra sobrescrita |

### Contatos

| Ferramenta | Descricao |
|---|---|
| `list_persons` | Lista contatos com paginacao |
| `search_persons` | Busca contatos por nome, email ou telefone |
| `get_person` | Detalhes completos de um contato |
| `create_person` | Cria contato (visivel para toda empresa) |
| `update_person` | Atualiza nome, email, telefone, organizacao |

### Organizacoes

| Ferramenta | Descricao |
|---|---|
| `search_organizations` | Busca organizacoes por nome |
| `get_organization` | Detalhes completos de uma organizacao |
| `create_organization` | Cria organizacao (visivel para toda empresa) |

### Atividades

| Ferramenta | Descricao |
|---|---|
| `list_activities` | Lista atividades com filtros por tipo (alias), usuario, periodo, negocio |
| `list_deal_activities` | Lista todas as atividades de um negocio especifico |
| `list_activity_types` | Lista tipos disponiveis com aliases e duracoes padrao |
| `create_activity` | Cria atividade — aceita key, nome ou alias como tipo, com duracao configuravel |
| `update_activity` | Atualiza atividade — remarcar, concluir, mudar tipo/duracao/responsavel |

### Notas

| Ferramenta | Descricao |
|---|---|
| `create_note` | Cria nota em negocio, contato ou organizacao |
| `update_note` | Edita conteudo de nota existente ou pina/despina no deal |
| `list_deal_notes` | Lista notas de um negocio |

### Produtos

| Ferramenta | Descricao |
|---|---|
| `list_products` | Lista produtos disponiveis |
| `add_product_to_deal` | Vincula produto a negocio com preco e quantidade |

### Estrutura

| Ferramenta | Descricao |
|---|---|
| `list_pipelines` | Lista todos os pipelines |
| `list_stages` | Lista etapas de um pipeline |
| `list_users` | Lista usuarios/membros da equipe |
