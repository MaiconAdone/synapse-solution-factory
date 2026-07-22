import path from "node:path";
import type { ProposedPatchOperation } from "../llm/types";

export function resolveSafePath(root: string, relativePath: string): string {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relativePath);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`Patch path escapes the workspace: ${relativePath}`);
  }
  return resolved;
}

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
    ...beforeLines.map((line) => `-${line}`),
    ...afterLines.map((line) => `+${line}`)
  ].join("\n");
}

export function applyPatchOperation(
  current: string,
  operation: ProposedPatchOperation
): string {
  if (operation.type === "replace") {
    assertContainsOnce(current, operation.expected, operation.path);
    return replaceOnce(current, operation.expected, operation.replacement);
  }
  if (operation.type === "delete") {
    assertContainsOnce(current, operation.expected, operation.path);
    return replaceOnce(current, operation.expected, "");
  }
  if (operation.type === "insert_before" || operation.type === "insert_after") {
    assertContainsOnce(current, operation.anchor, operation.path);
    const replacement =
      operation.type === "insert_before"
        ? `${operation.content}${operation.anchor}`
        : `${operation.anchor}${operation.content}`;
    return replaceOnce(current, operation.anchor, replacement);
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

/**
 * Substitui a primeira ocorrencia de `needle` por `replacement` sem interpretar
 * padroes especiais. String.prototype.replace com string de substituicao trata
 * sequencias `$&`, `$1`, `$$` etc. como referencias — o que corrompe codigo
 * gerado por modelos locais (template strings, regex, shell, jQuery). Fatiar por
 * indice preserva o texto literal. `assertContainsOnce` ja garante presenca.
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

function assertContainsOnce(current: string, needle: string, filePath: string): void {
  if (!needle) {
    throw new Error(`Patch operation for ${filePath} has an empty anchor.`);
  }
  const first = current.indexOf(needle);
  if (first < 0) {
    throw new Error(
      `Patch conflict in ${filePath}: expected text was not found. Refresh context before applying.`
    );
  }
  if (current.indexOf(needle, first + needle.length) >= 0) {
    throw new Error(
      `Patch conflict in ${filePath}: expected text is ambiguous. Use a larger unique anchor.`
    );
  }
}
