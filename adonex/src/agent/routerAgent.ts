import { extractJsonObject } from "./proposalParser";

/**
 * Decisao de roteamento produzida por um sub-agent rapido (modelo pequeno) antes
 * da edicao propriamente dita. Sequencial, nao paralelo: em CPU sem GPU varias
 * geracoes concorrentes so disputam o mesmo nucleo. O router gasta poucos tokens
 * para focar a geracao forte nos arquivos e papeis certos.
 */
export interface RouterDecision {
  focusFiles: string[];
  strategy: string;
  roles: string[];
}

/**
 * JSON Schema do router para structured outputs do Ollama. Mantido minimo para o
 * modelo rapido responder em poucos tokens.
 */
export const ROUTER_JSON_SCHEMA = {
  type: "object",
  properties: {
    focus_files: { type: "array", items: { type: "string" } },
    strategy: { type: "string" },
    roles: { type: "array", items: { type: "string" } }
  },
  required: ["focus_files", "strategy"]
} as const;

export function buildRouterSystemPrompt(): string {
  return [
    "Voce e o roteador do AdoneX: um sub-agent rapido que planeja a edicao antes do modelo de codigo.",
    "Escolha no MAXIMO 3 arquivos que realmente precisam mudar e resuma a estrategia em 1 frase.",
    "Sugira no maximo 3 papeis (ex.: backend, frontend, testing-qa, security).",
    "Responda SOMENTE com JSON valido, sem prosa nem cercas de codigo.",
    'Formato: {"focus_files": string[], "strategy": string, "roles": string[]}.'
  ].join("\n");
}

export function buildRouterUserPrompt(
  task: string,
  candidateFiles: string[]
): string {
  const files = candidateFiles.slice(0, 20);
  return [
    `Tarefa: ${task}`,
    "",
    "Arquivos candidatos do workspace:",
    ...(files.length ? files.map((file) => `- ${file}`) : ["- (nenhum arquivo relevante detectado)"]),
    "",
    "Retorne o JSON de roteamento."
  ].join("\n");
}

/**
 * Interpreta a saida do router com tolerancia a prosa/cercas. Filtra focus_files
 * pela lista de candidatos conhecidos (evita caminhos alucinados). Retorna
 * undefined quando nao ha nada aproveitavel — o router e best-effort e nunca
 * bloqueia a edicao.
 */
export function parseRouterDecision(
  text: string,
  candidateFiles: string[]
): RouterDecision | undefined {
  const raw = text?.trim();
  if (!raw) return undefined;
  const candidates = [raw, extractJsonObject(raw)];
  const known = new Set(candidateFiles);
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const parsed = JSON.parse(candidate) as Record<string, unknown>;
      const focusFiles = toStringArray(parsed.focus_files)
        .filter((file) => known.size === 0 || known.has(file))
        .slice(0, 3);
      const roles = toStringArray(parsed.roles).slice(0, 3);
      const strategy =
        typeof parsed.strategy === "string" ? parsed.strategy.trim() : "";
      if (!focusFiles.length && !strategy) continue;
      return { focusFiles, strategy, roles };
    } catch {
      continue;
    }
  }
  return undefined;
}

/**
 * Texto enxuto injetado no prompt da geracao forte. Substitui o council pesado
 * quando o router roda, mantendo o prompt curto e estavel (prefix-cache friendly).
 */
export function formatRouterGuidance(decision: RouterDecision): string {
  const lines = ["ADONEX ROUTER (sub-agent rapido) definiu o foco desta edicao:"];
  if (decision.strategy) {
    lines.push(`Estrategia: ${decision.strategy}`);
  }
  if (decision.focusFiles.length) {
    lines.push(`Arquivos-foco: ${decision.focusFiles.join(", ")}`);
  }
  if (decision.roles.length) {
    lines.push(`Papeis sugeridos: ${decision.roles.join(", ")}`);
  }
  lines.push(
    "Faca o menor patch seguro nesses arquivos, seguindo os padroes existentes."
  );
  return lines.join("\n");
}

/**
 * Decide se o sub-agent de roteamento deve rodar. O router so compensa em CPU
 * quando ha varios arquivos relevantes (o narrowing corta prompt-eval). Regras:
 * - `enabled=true` sempre roda (o usuario pediu explicitamente);
 * - senao, roda automaticamente quando ha `autoThreshold`+ arquivos relevantes;
 * - `autoThreshold<=0` desliga o modo automatico.
 * Assim, edicao de 1-2 arquivos pula o router (sem overhead) e trabalho
 * multi-arquivo ativa o narrowing sozinho, sem toggle manual.
 */
export function shouldRunRouter(
  enabled: boolean,
  autoThreshold: number,
  relevantCount: number
): boolean {
  if (enabled) return true;
  if (autoThreshold > 0 && relevantCount >= autoThreshold) return true;
  return false;
}

/**
 * Casa os focus_files do router contra os caminhos reais do snapshot. Tolerante a
 * formas ligeiramente diferentes (path completo x sufixo), pois o modelo pode
 * abreviar. Retorna os caminhos REAIS do snapshot que devem entrar no contexto.
 */
export function selectFocusPaths(
  candidatePaths: string[],
  focusFiles: string[]
): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const focus of focusFiles) {
    const needle = focus.trim();
    if (!needle) continue;
    for (const candidate of candidatePaths) {
      if (
        candidate === needle ||
        candidate.endsWith(needle) ||
        needle.endsWith(candidate)
      ) {
        if (!seen.has(candidate)) {
          seen.add(candidate);
          result.push(candidate);
        }
      }
    }
  }
  return result;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}
