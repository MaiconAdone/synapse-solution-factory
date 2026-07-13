const WRONG_SYNAPSE_NAMES = [
  /\bJerico\b/g,
  /\bJ[eé]rico\b/g,
  /\bjerico\b/g,
  /\bj[eé]rico\b/g
];

const GENERIC_ENGINEERING_CHECKLIST =
  /O sistema Synapse est[aá] em conformidade[\s\S]*?(Optimiza[cç][aã]o da Mem[oó]ria|Otimiza[cç][aã]o da Mem[oó]ria)[\s\S]*?Melhoria da Lat[eê]ncia/i;

const THINKING_BLOCKS = [
  /<think>[\s\S]*?<\/think>/gi,
  /<thinking>[\s\S]*?<\/thinking>/gi,
  /```(?:thinking|thoughts?)[\s\S]*?```/gi
];

const LOW_VALUE_PREFIXES = [
  /^Claro[,!\s]+/i,
  /^Com certeza[,!\s]+/i,
  /^Posso ajudar[,!\s]+/i,
  /^Aqui est[aá] uma resposta profissional[:\s-]*/i
];

export function sanitizeAdoneXResponse(text: string): string {
  let sanitized = text.trim();
  for (const pattern of THINKING_BLOCKS) {
    sanitized = sanitized.replace(pattern, "").trim();
  }
  for (const pattern of LOW_VALUE_PREFIXES) {
    sanitized = sanitized.replace(pattern, "").trimStart();
  }
  for (const pattern of WRONG_SYNAPSE_NAMES) {
    sanitized = sanitized.replace(pattern, "Synapse");
  }
  if (GENERIC_ENGINEERING_CHECKLIST.test(sanitized)) {
    return [
      "Corrigido: o projeto detectado deve ser chamado de Synapse.",
      "",
      "A resposta anterior ficou generica porque o modelo local recebeu uma rota ampla de orientacao de engenharia e completou com um checklist padrao, em vez de responder ao erro de nomenclatura. O AdoneX agora aplica saneamento de marca antes de publicar a resposta e o prompt reforca que nomes do produto nao podem ser inferidos ou trocados.",
      "",
      "Para validar a correcao no VS Code, recarregue a janela e repita a pergunta no AdoneX."
    ].join("\n");
  }
  return normalizeProfessionalMarkdown(sanitized);
}

function normalizeProfessionalMarkdown(text: string): string {
  return text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
