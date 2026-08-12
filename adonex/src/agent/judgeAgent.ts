import { extractJsonObject } from "./proposalParser";
import type { TestWeakeningFinding } from "../composer/validationLoop";

/**
 * Judge adversarial local, inspirado no fable-judge (fable-method,
 * Sahir619, MIT): confirma com um modelo local rapido se uma correcao de
 * teste que falhou resolveu a causa raiz ou apenas enfraqueceu a checagem.
 * So roda quando `detectTestWeakening` (deterministico, sem custo de LLM) ja
 * sinalizou algo suspeito — o judge nunca e a primeira linha de defesa.
 */

export type JudgeVerdict = "fixes_root_cause" | "weakens_test" | "uncertain";

export interface JudgeResult {
  verdict: JudgeVerdict;
  reason: string;
}

export const JUDGE_JSON_SCHEMA = {
  type: "object",
  properties: {
    verdict: {
      type: "string",
      enum: ["fixes_root_cause", "weakens_test", "uncertain"]
    },
    reason: { type: "string" }
  },
  required: ["verdict", "reason"]
} as const;

export function buildJudgeSystemPrompt(): string {
  return [
    "Voce e o judge adversarial do AdoneX: um sub-agent rapido que audita correcoes de teste.",
    "Uma checagem deterministica ja encontrou sinal de possivel enfraquecimento de teste (menos assertions, menos casos, novo skip/only, ou arquivo removido).",
    "Sua tarefa: comparar a falha original, o diff do teste e o diff do codigo de producao, e decidir se a correcao ataca a causa raiz ou so faz o teste parar de reclamar.",
    "Responda SOMENTE com JSON valido, sem prosa nem cercas de codigo.",
    'Formato: {"verdict": "fixes_root_cause" | "weakens_test" | "uncertain", "reason": string}.',
    "Use 'weakens_test' quando o diff do teste remove/enfraquece a checagem sem uma mudanca equivalente e justificada no codigo de producao.",
    "Use 'uncertain' quando a evidencia fornecida nao for suficiente para decidir com confianca."
  ].join("\n");
}

export function buildJudgeUserPrompt(
  capturedFailure: string,
  testDiffs: readonly { path: string; before?: string; after?: string }[],
  productionDiffs: readonly { path: string; before?: string; after?: string }[]
): string {
  return [
    "Falha original capturada:",
    capturedFailure.slice(0, 6_000),
    "",
    "Diff do(s) arquivo(s) de teste sinalizado(s):",
    formatDiffs(testDiffs),
    "",
    "Diff do(s) arquivo(s) de producao tocados pela mesma correcao:",
    productionDiffs.length ? formatDiffs(productionDiffs) : "(nenhum arquivo de producao foi alterado)",
    "",
    "Retorne o veredito em JSON."
  ].join("\n");
}

function formatDiffs(
  entries: readonly { path: string; before?: string; after?: string }[]
): string {
  if (!entries.length) return "(nenhum)";
  return entries
    .map((entry) =>
      [
        `--- ${entry.path} (antes) ---`,
        (entry.before ?? "(arquivo novo)").slice(0, 3_000),
        `--- ${entry.path} (depois) ---`,
        (entry.after ?? "(arquivo removido)").slice(0, 3_000)
      ].join("\n")
    )
    .join("\n\n");
}

/**
 * Interpreta o veredito do judge com tolerancia a prosa/cercas. Fail-closed:
 * qualquer resposta vazia, malformada ou fora do enum vira "uncertain" — o
 * judge e uma checagem de seguranca, entao a falha do proprio judge nao pode
 * liberar a correcao silenciosamente.
 */
export function parseJudgeVerdict(text: string): JudgeResult {
  const fallback: JudgeResult = {
    verdict: "uncertain",
    reason: "judge nao retornou veredito interpretavel"
  };
  const raw = text?.trim();
  if (!raw) return fallback;
  const candidates = [raw, extractJsonObject(raw)];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const parsed = JSON.parse(candidate) as Record<string, unknown>;
      const verdict = parsed.verdict;
      if (
        verdict === "fixes_root_cause" ||
        verdict === "weakens_test" ||
        verdict === "uncertain"
      ) {
        const reason =
          typeof parsed.reason === "string" && parsed.reason.trim()
            ? parsed.reason.trim()
            : fallback.reason;
        return { verdict, reason };
      }
    } catch {
      continue;
    }
  }
  return fallback;
}

/** Formata o veredito do judge como warning legivel para o usuario. */
export function formatJudgeWarning(
  finding: TestWeakeningFinding,
  result: JudgeResult
): string {
  return `fable-judge: ${finding.path} (${finding.reason}) -> veredito=${result.verdict}: ${result.reason}`;
}
