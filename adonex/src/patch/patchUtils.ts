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
    return current.replace(operation.expected, operation.replacement);
  }
  if (operation.type === "delete") {
    assertContainsOnce(current, operation.expected, operation.path);
    return current.replace(operation.expected, "");
  }
  if (operation.type === "insert_before" || operation.type === "insert_after") {
    assertContainsOnce(current, operation.anchor, operation.path);
    const replacement =
      operation.type === "insert_before"
        ? `${operation.content}${operation.anchor}`
        : `${operation.anchor}${operation.content}`;
    return current.replace(operation.anchor, replacement);
  }
  return current.endsWith("\n")
    ? `${current}${operation.content}`
    : `${current}\n${operation.content}`;
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
