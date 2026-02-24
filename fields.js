// Mapeamento completo dos campos personalizados de negócios do Pipedrive
// Gerado automaticamente a partir da API em 2026-02-21
// Para enum/set: options mapeia label → id

export const DEAL_CUSTOM_FIELDS = {
  "Telefone de atendimento": {
    key: "b5086d93ee164623499a2732173abd2f8d030f14",
    type: "enum",
    options: { "Central de Atendimento": 266, "Comercial Outbound": 261, "Eric Luciano": 263, "Niverton Menezes": 264 },
  },
  "Responsável por agendar a reunião": {
    key: "dcf2ec025b923c340cbaef3768913affb0738e5c",
    type: "user",
  },
  "Origem da Oportunidade": {
    key: "0945bdde00c8c57d1c0e52cd360cb76f058dc6e6",
    type: "enum",
    options: {
      "ORG | Automação do @ericluciano": 18, "ORG | Automação do @expertintegrado": 19,
      "ORG | SE Bio @ericluciano": 21, "ORG | SE Bio @expertintegrado": 85,
      "ORG | Mensagem receptiva de whatsapp": 30, "ORG | Palestra Eric Luciano": 103,
      "SS | @ericluciano": 35, "SS | @expertintegrado": 36,
      "OUT | Outbound Manual": 74, "OUT | Outbound Automático": 91,
      "INDIC | ChatGuru": 289, "INDIC | Geral": 88, "INDIC | Direta do Eric": 20,
      "BASE | Lead retomou conversa": 120, "BASE | Retomada programada": 121,
      "BASE | Campanha de base interna": 89,
      "CROS | Cliente Ativo": 22, "CROS | Cliente Inativo": 23,
      "CROS | Downsell de Projetos": 68, "CROS | Downsell de Educacional": 70,
      "CROS | Upsell de Educacional": 69,
      "EVENTO | ADVBOX": 172, "EVENTO | IA Summit Joinville 2025": 279,
      "EVENTO | Imersão Highticket 23": 64, "EVENTO | Imersão Highticket 24": 106,
      "EVENTO | Growth Conference 2024": 129, "EVENTO | Nova Era": 90,
      "EVENTO | WebSummit": 97, "EVENTO | Eric presencialmente": 122,
      "PUBLI | ADVBOX": 295, "PUBLI | G4 Tools": 300,
      "ADS | Facebook Leads": 302, "ADS | LP > Formulário": 136,
      "ADS | LP > WhatsApp": 137, "ADS | SE LP": 86,
      "ADS | SE Manychat": 87, "ADS | WhatsApp > SDR": 118,
      "Lançamento Mentoria Automações Inteligentes": 28, "Desconhecido": 31,
    },
  },
  "Detalhes da origem da oportunidade": {
    key: "c35bea7247f83fcb9cdc24abef1e4e793ae79d7d",
    type: "text",
  },
  "Pessoa que indicou": {
    key: "556319b09132ecf95ed5016f2689fcd35c35eb1c",
    type: "text",
  },
  "UTM": {
    key: "07a9dc3d4c97043cd4cc24bf6c66a28157524ae1",
    type: "text",
  },
  "Informações gerais": {
    key: "d8cf0aa0ea4d78645ec04c1d2733adf5e8d0e4dc",
    type: "text",
  },
  "Mídias e redes da empresa": {
    key: "d4a9418be97002929eb03787de8417a0e8c0715e",
    type: "text",
  },
  "Segmento": {
    key: "cb145b5c6af46b750f8d8806450ec8caa326681e",
    type: "enum",
    options: {
      "Academia e empresas de esporte": 139, "Agências em geral": 140,
      "Agência de Marketing": 141, "Arte e Cultura": 142, "Call Center": 267,
      "Clínica Estética": 143, "Clínica Médica": 144, "Contabilidade": 145,
      "Consultoria": 146, "Educação": 147, "Ecommerce": 148, "Energia": 149,
      "Entretenimento": 150, "Eventos": 151, "Imóveis e Construção": 152,
      "Indústria": 153, "Infoprodutos e Mentorias": 154, "Jurídico": 155,
      "Seguros": 156, "Serviços Financeiros": 157, "Serviços Gerais": 158,
      "Tecnologia e TI": 159, "Turismo e Viagens": 160, "Varejo": 161,
      "Vendas": 162, "Outros (descrever)": 163,
    },
  },
  "Nicho (antigo)": {
    key: "f4b9ae425863e29f71e433290e203ffd1ad20d32",
    type: "text",
  },
  "Nicho (detalhes adicionais)": {
    key: "48b5492b4f2f40dd29e65025e9d2bb04b92b12dc",
    type: "text",
  },
  "Produtos que oferece": {
    key: "c493507aa770ddb4be314b91c3e0d4fd8200e0a0",
    type: "text",
  },
  "Total de colaboradores": {
    key: "ae809a09fa42f7b947cd3f6897bb5d5253a34b48",
    type: "enum",
    options: {
      "1 a 5": 185, "6 a 10": 186, "11 a 20": 187, "20 a 50": 188,
      "51 a 100": 189, "101 a 200": 190, "201 a 500": 191,
      "501 a 1000": 192, "Acima de 1.000": 193, "❌ INFORMAÇÃO PENDENTE": 248,
    },
  },
  "Tamanho da equipe comercial": {
    key: "19d76e94901913d006699ae2bfc367db29c163e0",
    type: "double",
  },
  "Estrutura de colaboradores": {
    key: "5a21bff173a48476bb5d8b1f05dfa4e4c6b8cfa5",
    type: "text",
  },
  "Tipo de venda": {
    key: "89630cb09fa48c406f93f9a2fd1133e566151cae",
    type: "set",
    options: {
      "Agenda reuniões de venda": 131, "Vende direto por Whatsapp/Instagram": 132,
      "Vende direto por site": 164, "Transfere para outro vendedor": 284, "Outro": 134,
    },
  },
  "Canais de atendimento atuais": {
    key: "b2715700bb3a4ca0c8f985a1ae5decd98f1f862a",
    type: "set",
    options: {
      "Telefone inbound": 272, "Telefone outbound": 273,
      "WhatsApp Inbound": 274, "WhatsApp Outbound": 275,
      "E-mail outbound": 276, "Instagram inbound": 277,
      "Instagram outbound": 278, "❌ INFORMAÇÃO PENDENTE": 299,
    },
  },
  "Como funciona o processo de qualificação": {
    key: "ed7f16c1056e87e24bd7ed5cf887ac2fd22d9761",
    type: "text",
  },
  "Funis de vendas utilizados": {
    key: "204b24826dc0b83d15596c020af0940047271726",
    type: "text",
  },
  "Média de leads atendimentos por mês": {
    key: "d97738c0053b45d0aa3a80c0938b7886651399c1",
    type: "enum",
    options: {
      "Até 100": 194, "101 a 200": 195, "201 a 500": 196,
      "501 a 1.000": 197, "1.001 a 2.000": 198, "2.001 a 3.000": 199,
      "3.001 a 4.000": 200, "4.001 a 5.000": 201, "5.001 a 7.500": 202,
      "7.501 a 10.000": 203, "10.001 a 15.000": 204, "15.001 a 20.000": 205,
      "Acima de 20.000": 206, "❌ INFORMAÇÃO PENDENTE": 249,
    },
  },
  "Tamanho acumulado da lista de leads": {
    key: "8213b0f95fcd015515282938bbbe9d7f2f350a49",
    type: "enum",
    options: {
      "Não tem lista": 207, "Até 1.000": 208, "1.000 a 5.000": 209,
      "5.001 a 10.000": 210, "10.001 a 20.000": 211, "20.001 a 50.000": 212,
      "50.001 a 100.000": 213, "Acima de 100.000": 214, "❌ INFORMAÇÃO PENDENTE": 255,
    },
  },
  "Detalhes sobre volume de Leads e Clientes": {
    key: "81fcda97e5721b31ae3762a7d7d5c42bcf375256",
    type: "text",
  },
  "Automações que utiliza atualmente": {
    key: "dc1db4be9cc7ba451e72973c694082ce25e7b403",
    type: "text",
  },
  "Ferramenta de WhatsApp atual": {
    key: "aa66ed5229ac03a26dd46562b29229844956fe73",
    type: "enum",
    options: {
      "Outra": 243, "WhatsApp Web": 237, "Bitrix 24 (Power Zap)": 256,
      "Botconversa": 238, "ChatGuru": 220, "Clint": 244, "Digisac": 254,
      "Expert Integrado": 219, "Letalk": 250, "Kommo": 245, "ManyChat": 239,
      "RD Conversas (Tallos)": 246, "Take Blip": 240, "Wati": 241, "Zenvia": 242,
      "❌ INFORMAÇÃO PENDENTE": 251,
    },
  },
  "CRM atual": {
    key: "3826c1a1ba8d3007dd543567f103ecf4092e4f05",
    type: "enum",
    options: {
      "Não utiliza": 215, "Active Campaign": 221, "Agendor": 222, "ADVBOX": 247,
      "Bitrix24": 223, "Clint": 235, "Exact Sales": 269,
      "Funil de ferramenta de WhatsApp": 288, "HubSpot": 225, "Kommo": 226,
      "Monday": 227, "Moskit": 228, "Nectar": 229, "Pipedrive": 230,
      "Pipefy": 282, "PipeRun": 231, "Ploomes": 280, "RD Station": 232,
      "Salesforce": 233, "Zoho": 234, "Outro": 252, "❌ INFORMAÇÃO PENDENTE": 253,
    },
  },
  "Outras ferramentas": {
    key: "2a36226e2dbdb520a00ea722e005b86d7c290c80",
    type: "text",
  },
  "Dores": {
    key: "56bda3134566fb875bcfdd818a0f062e92eae9c3",
    type: "text",
  },
  "Objetivos com a automação": {
    key: "dda859b434890ba404287188216f515bdc8a8f4d",
    type: "text",
  },
  "Oportunidades de melhoria": {
    key: "ffe3b60ae854bf6892f158651f3dcd7174919d93",
    type: "text",
  },
  "Tempo de mercado": {
    key: "d4066eb2aa7a5be1eae0aac58c2e9cfe6e44a972",
    type: "text",
  },
  "Empresa (desativado)": {
    key: "912203dcdda287756c99116ec35134fbe419aebd",
    type: "text",
  },
  "Faturamento mensal": {
    key: "b3dc5494f132dd27f85581f4b766f91d8ccaa7fb",
    type: "text",
  },
  "Nível de prioridade da contratação": {
    key: "4418e79f94f920a14ce539cb50173b31f4380fb2",
    type: "enum",
    options: { "Baixa": 98, "Média": 99, "Alta": 100, "Crítica": 101 },
  },
  "Unidade de Negócio": {
    key: "e5d73528b2f2b2a6faed903a44c5602a88da59c2",
    type: "enum",
    options: { "Não definido": 76, "Saas": 16, "Educacional": 17, "Projeto": 15 },
  },
  "CRM que será integrado": {
    key: "62c41fe41ba2040065f31f079b26665871dc1a69",
    type: "enum",
    options: {
      "Sem integração": 176, "ADVBOX": 285, "Bitrix 24": 183, "Clint": 181,
      "ChatGuru - Funil": 286, "Exact Sales": 182, "Expert Integrado - Funil": 287,
      "Hubspot": 178, "Kommo": 180, "Pipefy (somente V1)": 283,
      "Pipedrive": 177, "Piperun (somente V1)": 257, "Ploomes": 281,
      "RD Station": 179, "Sales Force (somente V1)": 270,
      "Zoho (somente V1)": 184, "Customização (Plano Black)": 292,
    },
  },
  "WhatsApp que será integrado": {
    key: "465b392cb72f563e38b36cc6af2262ff49d63c06",
    type: "enum",
    options: {
      "Expert Integrado": 165, "ChatGuru": 167, "Digisac": 296,
      "Bitrix24 | Power Zap": 236, "Botconversa": 168,
      "Take Blip (somente V1)": 297, "Z-API": 166, "Customizado (Plano Black)": 271,
    },
  },
  "Forma de Pagamento": {
    key: "513713087f8d84c19e42f6c3bfd6b3b187ee127a",
    type: "text",
  },
  "Especificações do projeto": {
    key: "0a8bc2813fae2593b83e898bd87451054e6888a1",
    type: "text",
  },
  "Negociações adicionais": {
    key: "a73f0b5bdc689c3af3f3e8eacc76e7b7c503e8b2",
    type: "text",
  },
  "Prazo acordado": {
    key: "fc98f1aa09a019e45f2e54c1f1a26ed7d2b2949b",
    type: "text",
  },
  "Link do Clickup": {
    key: "fe16bf8c498c4c7f79f201a23f4b7a9f2205cba7",
    type: "text",
  },
  "Link da Proposta": {
    key: "5144dc60e7de928345b6587bafd7a31c209829b3",
    type: "text",
  },
  "Briefing Prospecção": {
    key: "04d4ee9c80e66389c54d1ec1857d80ddd14f2960",
    type: "text",
  },
  "Status da Prospecção": {
    key: "21274e04e6c8787c41ca4fb13920d4c7bf21b463",
    type: "set",
    options: { "Mapeado": 93, "Iniciado": 94, "Perdido": 95, "Convertido": 96 },
  },
  "Canal de Comunicação": {
    key: "a8e2b7173d0bb54f2e2ab90bd52611f9af9e2139",
    type: "enum",
    options: { "Instaram @ericluciano": 81, "Instagram @expertintegrado": 82, "WhatsApp": 83 },
  },
  "Resumo Prospecção": {
    key: "5a051586894fcdd5b1dd1d2bab4624feab888b15",
    type: "text",
  },
  "Temperatura Prospecção": {
    key: "d36714d0cd407fdc8aeed7d5c297586cf3666b19",
    type: "enum",
    options: { "frio": 78, "morno": 79, "quente": 80 },
  },
  "Insights técnicos": {
    key: "2fc99d94cd364f5dd3304b71500796ae9bd7cad0",
    type: "text",
  },
  "Insights de Vendas": {
    key: "b916e585acf056bdb5a89a8820a17e5f6d1abfdc",
    type: "text",
  },
};

// Mapa reverso: key da API → nome legível
export const KEY_TO_NAME = {};
for (const [name, field] of Object.entries(DEAL_CUSTOM_FIELDS)) {
  KEY_TO_NAME[field.key] = name;
}

// Mapa reverso para enum/set: key da API → { id → label }
export const KEY_TO_OPTIONS = {};
for (const [name, field] of Object.entries(DEAL_CUSTOM_FIELDS)) {
  if (field.options) {
    const idToLabel = {};
    for (const [label, id] of Object.entries(field.options)) {
      idToLabel[id] = label;
    }
    KEY_TO_OPTIONS[field.key] = idToLabel;
  }
}
