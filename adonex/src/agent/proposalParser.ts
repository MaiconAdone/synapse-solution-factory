import type {
  ImplementationProposal,
  ProposedFileChange,
  ProposedPatchOperation
} from "../llm/types";

/**
 * JSON Schema da proposta de patch do AdoneX. Passado ao Ollama em `format`
 * (structured outputs) para restringir a geracao do modelo local ao formato
 * exato, eliminando a maior parte das falhas de parsing na origem. `operations`
 * fica frouxo de proposito: a uniao discriminada e validada em `parseProposalText`,
 * e restringir demais faz modelos pequenos travarem ou degradarem.
 */
export const PROPOSAL_JSON_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    changes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" }
        },
        required: ["path", "content"]
      }
    },
    operations: {
      type: "array",
      items: { type: "object" }
    },
    commands: {
      type: "array",
      items: { type: "string" }
    }
  },
  required: ["summary", "changes", "commands"]
} as const;

export class ProposalParseError extends Error {}

/**
 * Extrai o primeiro objeto JSON balanceado de dentro de um texto que pode conter
 * prosa, cercas de codigo ou multiplos blocos. Ignora chaves dentro de strings
 * (inclusive escapes), entao nao se perde com `{` em conteudo de codigo.
 * Retorna undefined se nao houver objeto balanceado.
 */
export function extractJsonObject(text: string): string | undefined {
  const start = text.indexOf("{");
  if (start < 0) return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }
  return undefined;
}

/**
 * Reparos conservadores de JSON quase valido produzido por modelos locais:
 * remove cercas de codigo, comentarios de linha/bloco e virgulas sobrando antes
 * de `}`/`]`. Nao toca no conteudo de strings.
 */
export function repairJsonText(text: string): string {
  const withoutFences = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  let result = "";
  let inString = false;
  let escaped = false;
  for (let index = 0; index < withoutFences.length; index += 1) {
    const char = withoutFences[index];
    const next = withoutFences[index + 1];
    if (inString) {
      result += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      result += char;
      continue;
    }
    // Comentario de linha // ... ate o fim da linha.
    if (char === "/" && next === "/") {
      const newline = withoutFences.indexOf("\n", index);
      if (newline < 0) break;
      index = newline - 1;
      continue;
    }
    // Comentario de bloco /* ... */.
    if (char === "/" && next === "*") {
      const close = withoutFences.indexOf("*/", index + 2);
      if (close < 0) break;
      index = close + 1;
      continue;
    }
    result += char;
  }
  // Remove virgulas penduradas: `,` seguido (apenas por espaco) de } ou ].
  return result.replace(/,(\s*[}\]])/g, "$1");
}

/**
 * Interpreta o texto do modelo como uma proposta de patch, com varias camadas de
 * tolerancia: parse direto, extracao do objeto balanceado, e reparo conservador.
 * Normaliza os arrays e descarta operacoes malformadas em vez de falhar tudo.
 * Lanca ProposalParseError apenas quando nao ha JSON aproveitavel.
 */
export function parseProposalText(text: string): ImplementationProposal {
  const raw = text?.trim();
  if (!raw) {
    throw new ProposalParseError("O modelo retornou uma resposta vazia.");
  }
  const candidates = dedupe([
    raw,
    stripFences(raw),
    extractJsonObject(raw),
    repairJsonText(raw),
    extractJsonObject(repairJsonText(raw))
  ]);
  let lastError: unknown;
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      return normalizeProposal(JSON.parse(candidate));
    } catch (error) {
      lastError = error;
    }
  }
  throw new ProposalParseError(
    `O modelo nao retornou um JSON de proposta valido: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`
  );
}

/**
 * Prompt de reparo: reenviado ao modelo quando o parse falha. Mantido curto e
 * direto para gastar poucos tokens em CPU.
 */
export function buildProposalRepairPrompt(previousText: string): string {
  return [
    "Sua saida anterior NAO era um JSON valido de proposta de patch do AdoneX.",
    "Devolva SOMENTE um objeto JSON valido, sem prosa, sem comentarios e sem cercas de codigo.",
    'Formato: {"summary": string, "changes": [{"path": string, "content": string}], "operations": [], "commands": [string]}.',
    "",
    "Sua saida anterior foi:",
    previousText.slice(0, 6_000)
  ].join("\n");
}

function stripFences(text: string): string {
  return text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

function dedupe(values: Array<string | undefined>): Array<string | undefined> {
  const seen = new Set<string>();
  const result: Array<string | undefined> = [];
  for (const value of values) {
    if (value === undefined) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function normalizeProposal(value: unknown): ImplementationProposal {
  if (!value || typeof value !== "object") {
    throw new ProposalParseError("A proposta nao e um objeto JSON.");
  }
  const record = value as Record<string, unknown>;
  const changes = normalizeChanges(record.changes);
  const operations = normalizeOperations(record.operations);
  if (!changes.length && !operations.length) {
    throw new ProposalParseError(
      "A proposta nao contem nenhuma mudanca de arquivo (changes) nem operacao (operations)."
    );
  }
  return {
    summary: typeof record.summary === "string" ? record.summary : "",
    changes,
    operations,
    commands: normalizeStringArray(record.commands)
  };
}

function normalizeChanges(value: unknown): ProposedFileChange[] {
  if (!Array.isArray(value)) return [];
  const changes: ProposedFileChange[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (typeof record.path !== "string" || typeof record.content !== "string") continue;
    if (!record.path.trim()) continue;
    changes.push({ path: record.path, content: record.content });
  }
  return changes;
}

function normalizeOperations(value: unknown): ProposedPatchOperation[] {
  if (!Array.isArray(value)) return [];
  const operations: ProposedPatchOperation[] = [];
  for (const item of value) {
    const operation = normalizeOperation(item);
    if (operation) operations.push(operation);
  }
  return operations;
}

function normalizeOperation(value: unknown): ProposedPatchOperation | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const type = record.type;
  const path = record.path;
  if (typeof type !== "string" || typeof path !== "string" || !path.trim()) {
    return undefined;
  }
  if (type === "replace") {
    if (typeof record.expected !== "string" || typeof record.replacement !== "string") {
      return undefined;
    }
    return { type, path, expected: record.expected, replacement: record.replacement };
  }
  if (type === "delete") {
    if (typeof record.expected !== "string") return undefined;
    return { type, path, expected: record.expected };
  }
  if (type === "insert_before" || type === "insert_after") {
    if (typeof record.anchor !== "string" || typeof record.content !== "string") {
      return undefined;
    }
    return { type, path, anchor: record.anchor, content: record.content };
  }
  if (type === "append") {
    if (typeof record.content !== "string") return undefined;
    return { type, path, content: record.content };
  }
  return undefined;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}
