import type { WorkspaceSnapshot } from "../llm/types";

export interface HallucinationGuardEvidence {
  files: string[];
  commands: string[];
  stack: string[];
  synapseDetected: boolean;
}

const SPECULATIVE_CERTAINTY = [
  /\b(com certeza|certamente|garantido|sem d[uú]vida)\b/i,
  /\b(est[aá] implementado|foi aplicado|foi executado|foi criado)\b/i,
  /\b(o arquivo .* foi alterado)\b/i
];

const INVENTED_PROVIDER_NAMES = [
  /\bJerico\b/i,
  /\bJ[eé]rico\b/i,
  /\bAutoGPT\b/i,
  /\bLangChain\b/i,
  /\bPinecone\b/i,
  /\bKubernetes\b/i
];

const UNSUPPORTED_EXECUTION_CLAIMS = [
  /\b(rodei|executei|testei|validei|compilei|apliquei|salvei)\b/i,
  /\b(os testes passaram|build passou|servidor esta rodando|servidor est[aá] rodando)\b/i,
  /\b(patch aplicado|mudan[cç]a aplicada|arquivo salvo)\b/i
];

const UNCERTAINTY_MARKERS = /\b(infer[eê]ncia|hip[oó]tese|precisa verificar|a verificar|sem evid[eê]ncia|n[aã]o tenho evid[eê]ncia)\b/i;

export function evidenceFromSnapshot(
  snapshot: WorkspaceSnapshot,
  commands: string[] = []
): HallucinationGuardEvidence {
  return {
    files: [
      ...snapshot.structure,
      ...snapshot.relevantFiles.map((file) => file.path)
    ].map((file) => file.replace(/\\/g, "/")),
    commands,
    stack: snapshot.stack,
    synapseDetected: snapshot.synapseDetected
  };
}

export function guardAgainstLocalHallucinations(
  text: string,
  evidence?: HallucinationGuardEvidence
): string {
  const warnings: string[] = [];
  const guardedText = softenUnsupportedClaims(text, evidence, warnings);
  for (const pattern of SPECULATIVE_CERTAINTY) {
    if (pattern.test(guardedText) && !UNCERTAINTY_MARKERS.test(guardedText)) {
      warnings.push("remova certeza operacional sem evidência do host");
      break;
    }
  }
  for (const pattern of INVENTED_PROVIDER_NAMES) {
    if (pattern.test(guardedText) && !evidenceAllowsTerm(pattern, evidence)) {
      warnings.push("possível nome/tecnologia inventada fora do contexto fornecido");
      break;
    }
  }
  const mentionedFiles = extractMentionedFiles(guardedText);
  const unknownFiles = evidence
    ? mentionedFiles.filter((file) => !evidence.files.includes(file.replace(/\\/g, "/")))
    : [];
  if (unknownFiles.length) {
    warnings.push(`arquivo(s) sem evidência no contexto: ${unknownFiles.slice(0, 5).join(", ")}`);
  }
  if (!warnings.length) return text;
  return [
    "**Nota de confiabilidade local:** revisei a resposta para reduzir alucinações do modelo local.",
    `- Sinais detectados: ${warnings.join("; ")}.`,
    "- Considere como confirmadas apenas afirmações sustentadas por arquivos, comandos ou resultados exibidos pelo AdoneX.",
    "",
    guardedText
  ].join("\n");
}

function softenUnsupportedClaims(
  text: string,
  evidence: HallucinationGuardEvidence | undefined,
  warnings: string[]
): string {
  if (!evidence || UNCERTAINTY_MARKERS.test(text)) return text;
  const claimsExecution = UNSUPPORTED_EXECUTION_CLAIMS.some((pattern) => pattern.test(text));
  if (!claimsExecution) return text;
  const hasCommandEvidence = evidence.commands.some((command) => command.trim().length > 0);
  if (hasCommandEvidence) return text;
  warnings.push("afirmação de execução/teste sem comando confirmado");
  return [
    "Não tenho evidência do host de que comandos, testes, builds ou patches tenham sido executados nesta interação.",
    "Reformulação segura da resposta do modelo local:",
    "",
    text
  ].join("\n");
}

function extractMentionedFiles(text: string): string[] {
  const matches = text.match(/[`\s]([\w.-]+\/[\w./-]+\.(?:ts|tsx|js|jsx|py|json|md|yml|yaml|toml|css|html|ps1|sql))[`\s.,:;)]/g) ?? [];
  return [...new Set(matches.map((match) => match.trim().replace(/^[`\s]+|[`\s.,:;)]+$/g, "")))]
    .map((file) => file.replace(/\\/g, "/"));
}

function evidenceAllowsTerm(pattern: RegExp, evidence?: HallucinationGuardEvidence): boolean {
  if (!evidence) return false;
  return evidence.stack.some((item) => pattern.test(item)) || evidence.files.some((file) => pattern.test(file));
}