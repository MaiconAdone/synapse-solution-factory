import path from "node:path";
import type {
  HighRiskRewrite,
  ProposedFileChange,
  ProposedPatchOperation
} from "../llm/types";
import { diffLines } from "./textDiff";

export function resolveSafePath(root: string, relativePath: string): string {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relativePath);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`Patch path escapes the workspace: ${relativePath}`);
  }
  return resolved;
}

/**
 * Diff unificado real (LCS via diffLines de ./textDiff): linhas iguais entram
 * como contexto (` `), so as linhas que realmente mudaram viram `-`/`+`. Antes
 * disto o diff despejava o arquivo inteiro como removido+adicionado mesmo para
 * uma edicao de 1 linha (ex.: uma operation cirurgica do Tool Loop), inflando
 * o resumo falado/textual do patch (patch/patchSummary.ts) para o tamanho do
 * arquivo inteiro em vez do tamanho real da mudanca.
 */
export function createSimpleDiff(
  relativePath: string,
  before: string,
  after: string
): string {
  const beforeLines = before ? before.split(/\r?\n/) : [];
  const afterLines = after ? after.split(/\r?\n/) : [];
  const oldPath = before ? `a/${relativePath}` : "/dev/null";
  return [
    `diff --git a/${relativePath} b/${relativePath}`,
    `--- ${oldPath}`,
    `+++ b/${relativePath}`,
    `@@ -${beforeLines.length ? 1 : 0},${beforeLines.length} +${
      afterLines.length ? 1 : 0
    },${afterLines.length} @@`,
    ...diffLines(before, after).map((line) => `${line.tag}${line.text}`)
  ].join("\n");
}

export function applyPatchOperation(
  current: string,
  operation: ProposedPatchOperation
): string {
  if (operation.type === "replace") {
    const match = locateAnchor(current, operation.expected, operation.path);
    // Match exato ja traz a indentacao correta no expected; matches tolerantes
    // realinham a indentacao do replacement com a do trecho encontrado.
    const replacement =
      match.via === "exact"
        ? operation.replacement
        : reindentLikeMatch(operation.replacement, current.slice(match.start, match.end));
    return current.slice(0, match.start) + replacement + current.slice(match.end);
  }
  if (operation.type === "delete") {
    const match = locateAnchor(current, operation.expected, operation.path);
    return current.slice(0, match.start) + current.slice(match.end);
  }
  if (operation.type === "insert_before" || operation.type === "insert_after") {
    const match = locateAnchor(current, operation.anchor, operation.path);
    const boundary = operation.type === "insert_before" ? match.start : match.end;
    return current.slice(0, boundary) + operation.content + current.slice(boundary);
  }
  return current.endsWith("\n")
    ? `${current}${operation.content}`
    : `${current}\n${operation.content}`;
}

/**
 * Aplica uma sequencia de operations sobre conteudos conhecidos, encadeando
 * operations do mesmo arquivo. Puro e testavel: o chamador fornece o conteudo
 * atual de cada path (disco, preview ou fixture) e recebe o conteudo final.
 * Conflitos de anchor/expected lancam erro antes de qualquer escrita.
 */
export function applyOperationsToContents(
  operations: readonly ProposedPatchOperation[],
  currentByPath: ReadonlyMap<string, string>
): Map<string, string> {
  const changed = new Map<string, string>();
  for (const operation of operations) {
    const current = changed.get(operation.path) ?? currentByPath.get(operation.path) ?? "";
    changed.set(operation.path, applyPatchOperation(current, operation));
  }
  return changed;
}

/** Similaridade minima (media por linha) para aceitar um anchor fuzzy. */
export const FUZZY_ANCHOR_THRESHOLD = 0.7;

interface AnchorMatch {
  start: number;
  end: number;
  via: "exact" | "normalized" | "fuzzy";
}

/**
 * Localiza o anchor/expected no conteudo atual em cascata, tolerando os erros
 * tipicos de modelos locais pequenos:
 * 1. match exato (byte a byte) — comportamento original;
 * 2. match normalizado — ignora indentacao, espacos a direita e colapsa
 *    espacos internos, mapeando o span de volta ao texto original;
 * 3. match fuzzy — janela de linhas com similaridade media (Dice de bigramas)
 *    acima do limiar, aceita somente quando ha um unico melhor candidato.
 * Lanca erro quando nao encontra nada ou quando ha ambiguidade em qualquer
 * estagio — nunca "chuta" um trecho para aplicar.
 */
function locateAnchor(current: string, needle: string, filePath: string): AnchorMatch {
  if (!needle) {
    throw new Error(`Patch operation for ${filePath} has an empty anchor.`);
  }
  const first = findExactAnchor(current, needle);
  if (first >= 0) {
    if (findExactAnchor(current, needle, first + needle.length) >= 0) {
      throw ambiguousAnchor(filePath);
    }
    return { start: first, end: first + needle.length, via: "exact" };
  }

  const needleLines = needle.split(/\r?\n/);
  while (needleLines.length && !needleLines[0].trim()) needleLines.shift();
  while (needleLines.length && !needleLines[needleLines.length - 1].trim()) {
    needleLines.pop();
  }
  if (!needleLines.length) {
    throw notFoundAnchor(filePath);
  }
  const normalizedNeedle = needleLines.map(normalizeAnchorLine);
  const currentLines = current.split("\n");
  const lineStarts: number[] = [];
  let offset = 0;
  for (const line of currentLines) {
    lineStarts.push(offset);
    offset += line.length + 1;
  }
  const normalizedCurrent = currentLines.map((line) =>
    normalizeAnchorLine(line.replace(/\r$/, ""))
  );

  const spanAt = (index: number): { start: number; end: number } => {
    const last = index + normalizedNeedle.length - 1;
    return { start: lineStarts[index], end: lineStarts[last] + currentLines[last].length };
  };

  // Estagio 2: igualdade apos normalizacao de whitespace.
  const normalizedMatches: number[] = [];
  for (let index = 0; index + normalizedNeedle.length <= normalizedCurrent.length; index += 1) {
    let equal = true;
    for (let inner = 0; inner < normalizedNeedle.length; inner += 1) {
      if (normalizedCurrent[index + inner] !== normalizedNeedle[inner]) {
        equal = false;
        break;
      }
    }
    if (equal) normalizedMatches.push(index);
  }
  if (normalizedMatches.length === 1) {
    return { ...spanAt(normalizedMatches[0]), via: "normalized" };
  }
  if (normalizedMatches.length > 1) {
    throw ambiguousAnchor(filePath);
  }

  // Estagio 3: melhor janela por similaridade media de linhas; exige candidato
  // unico acima do limiar para nao aplicar no trecho errado.
  let bestIndex = -1;
  let bestScore = 0;
  let bestTies = 0;
  for (let index = 0; index + normalizedNeedle.length <= normalizedCurrent.length; index += 1) {
    let total = 0;
    for (let inner = 0; inner < normalizedNeedle.length; inner += 1) {
      total += lineSimilarity(normalizedCurrent[index + inner], normalizedNeedle[inner]);
    }
    const score = total / normalizedNeedle.length;
    if (score < FUZZY_ANCHOR_THRESHOLD) continue;
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
      bestTies = 1;
    } else if (score === bestScore) {
      bestTies += 1;
    }
  }
  if (bestIndex >= 0 && bestTies === 1) {
    return { ...spanAt(bestIndex), via: "fuzzy" };
  }
  if (bestTies > 1) {
    throw ambiguousAnchor(filePath);
  }
  throw notFoundAnchor(filePath);
}

/**
 * Evita tratar um anchor indentado como match exato quando ele comeca no meio
 * da indentacao real da linha. Nesse caso o estagio normalizado deve comparar
 * a linha inteira e devolver um span que preserve corretamente seus limites.
 */
function findExactAnchor(current: string, needle: string, fromIndex = 0): number {
  let index = current.indexOf(needle, fromIndex);
  while (index >= 0) {
    const lineStart = current.lastIndexOf("\n", index - 1) + 1;
    const prefix = current.slice(lineStart, index);
    const startsWithWhitespace = /^[ \t]/.test(needle);
    if (!(startsWithWhitespace && prefix.length > 0 && /^[ \t]+$/.test(prefix))) {
      return index;
    }
    index = current.indexOf(needle, index + 1);
  }
  return -1;
}

/** Colapsa diferencas de whitespace que modelos pequenos introduzem com frequencia. */
function normalizeAnchorLine(line: string): string {
  return line.trim().replace(/\s+/g, " ");
}

/**
 * Realinha a indentacao de um replacement com a do trecho casado: remove a
 * indentacao comum do replacement (a do modelo, muitas vezes errada) e aplica
 * a indentacao da primeira linha encontrada no arquivo. Linhas vazias ficam
 * intactas. So e usado em matches nao exatos (normalized/fuzzy).
 */
function reindentLikeMatch(replacement: string, matched: string): string {
  const matchedFirstLine = matched.split("\n", 1)[0] ?? "";
  const baseIndent = /^[ \t]*/.exec(matchedFirstLine)?.[0] ?? "";
  if (!baseIndent) return replacement;
  const lines = replacement.split("\n");
  const indents = lines
    .filter((line) => line.trim())
    .map((line) => /^[ \t]*/.exec(line)?.[0].length ?? 0);
  const strip = indents.length ? Math.min(...indents) : 0;
  return lines
    .map((line) => (line.trim() ? `${baseIndent}${line.slice(strip)}` : line))
    .join("\n");
}

/**
 * Similaridade de Dice sobre bigramas da linha (0..1). Robusta a pequenas
 * divergencias tipicas de modelo local (espacos, pontuacao, identificador
 * trocado) sem custo de Levenshtein completo.
 */
function lineSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const bigrams = (value: string): Map<string, number> => {
    const counts = new Map<string, number>();
    for (let index = 0; index < value.length - 1; index += 1) {
      const bigram = value.slice(index, index + 2);
      counts.set(bigram, (counts.get(bigram) ?? 0) + 1);
    }
    return counts;
  };
  const left = bigrams(a);
  const right = bigrams(b);
  let overlap = 0;
  for (const [bigram, count] of left) {
    overlap += Math.min(count, right.get(bigram) ?? 0);
  }
  return (2 * overlap) / (a.length - 1 + (b.length - 1));
}

function notFoundAnchor(filePath: string): Error {
  return new Error(
    `Patch conflict in ${filePath}: expected text was not found. Refresh context before applying.`
  );
}

function ambiguousAnchor(filePath: string): Error {
  return new Error(
    `Patch conflict in ${filePath}: expected text is ambiguous. Use a larger unique anchor.`
  );
}

/**
 * Substitui a primeira ocorrencia de `needle` por `replacement` sem interpretar
 * padroes especiais. String.prototype.replace com string de substituicao trata
 * sequencias `$&`, `$1`, `$$` etc. como referencias — o que corrompe codigo
 * gerado por modelos locais (template strings, regex, shell, jQuery). Fatiar por
 * indice preserva o texto literal.
 */
export function replaceOnce(
  haystack: string,
  needle: string,
  replacement: string
): string {
  const index = haystack.indexOf(needle);
  if (index < 0) return haystack;
  return haystack.slice(0, index) + replacement + haystack.slice(index + needle.length);
}

/** Fracao de linhas removidas acima da qual um rewrite whole-file e de alto risco. */
export const HIGH_RISK_REWRITE_THRESHOLD = 0.5;
/** Arquivos menores que isso nao disparam a guarda (reescrita pequena e comum). */
export const HIGH_RISK_REWRITE_MIN_LINES = 5;

/**
 * Detecta rewrites whole-file que apagam a maior parte do arquivo existente.
 * Modelos locais as vezes veem apenas um excerpt do arquivo (com o meio cortado)
 * e devolvem um "arquivo completo" alucinado/truncado; aplicar isso cegamente
 * destruiria codigo que o modelo nunca viu. A comparacao e por multiconjunto de
 * linhas: uma linha conta como preservada se ainda existe no novo conteudo.
 * Arquivos novos (ausentes em `currentByPath`) nunca sao marcados.
 */
export function detectHighRiskRewrites(
  changes: readonly ProposedFileChange[],
  currentByPath: ReadonlyMap<string, string>,
  threshold = HIGH_RISK_REWRITE_THRESHOLD
): HighRiskRewrite[] {
  const results: HighRiskRewrite[] = [];
  for (const change of changes) {
    const before = currentByPath.get(change.path);
    if (!before) continue;
    const beforeLines = before.split(/\r?\n/);
    if (beforeLines.length < HIGH_RISK_REWRITE_MIN_LINES) continue;
    const afterLines = change.content.split(/\r?\n/);
    const pool = new Map<string, number>();
    for (const line of afterLines) {
      pool.set(line, (pool.get(line) ?? 0) + 1);
    }
    let kept = 0;
    for (const line of beforeLines) {
      const available = pool.get(line) ?? 0;
      if (available > 0) {
        pool.set(line, available - 1);
        kept += 1;
      }
    }
    const removedRatio = (beforeLines.length - kept) / beforeLines.length;
    if (removedRatio > threshold) {
      results.push({
        path: change.path,
        beforeLines: beforeLines.length,
        afterLines: afterLines.length,
        removedPercent: Math.round(removedRatio * 100)
      });
    }
  }
  return results;
}
