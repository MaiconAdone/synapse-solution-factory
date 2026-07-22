import assert from "node:assert/strict";
import test from "node:test";
import { selectFocusFilesByGraph } from "../src/context/focusSelector";

const files = [
  {
    path: "src/patch/patchUtils.ts",
    content:
      "export function applyPatchOperation(current, op) { return current; }\n" +
      "export function replaceOnce(a, b, c) { return a; }\n"
  },
  {
    path: "src/patch/patchEngine.ts",
    content:
      'import { applyPatchOperation } from "./patchUtils";\n' +
      "export class PatchEngine { generate() {} }\n"
  },
  {
    path: "src/agent/proposalParser.ts",
    content: "export function parseProposalText(text) { return {}; }\n"
  }
];

test("picks the file whose exported symbol the task names", () => {
  const focus = selectFocusFilesByGraph(
    "No applyPatchOperation, valide que o path nao esteja vazio",
    files
  );
  assert.deepEqual(focus, ["src/patch/patchUtils.ts"]);
});

test("matches by file basename mentioned in the task", () => {
  const focus = selectFocusFilesByGraph(
    "atualize o proposalParser para tolerar comentarios",
    files
  );
  assert.deepEqual(focus, ["src/agent/proposalParser.ts"]);
});

test("returns empty (inconclusive) when the task names nothing concrete", () => {
  const focus = selectFocusFilesByGraph(
    "melhore a arquitetura geral do sistema",
    files
  );
  assert.deepEqual(focus, []);
});

test("does not narrow when fewer than two candidates", () => {
  assert.deepEqual(
    selectFocusFilesByGraph("applyPatchOperation", [files[0]]),
    []
  );
});

test("does not narrow when the focus would cover every candidate", () => {
  // Both files reference symbols the task names -> no reduction, stay full.
  const focus = selectFocusFilesByGraph("applyPatchOperation e parseProposalText", [
    files[0],
    files[2]
  ]);
  assert.deepEqual(focus, []);
});

test("graph in-degree breaks ties toward the imported (central) file", () => {
  const tie = [
    { path: "src/core.ts", content: "export function shared() {}\n" },
    { path: "src/a.ts", content: 'import { shared } from "./core";\nexport function shared() {}\n' }
  ];
  // Task names 'shared' (exported in both); core.ts wins by in-degree (imported by a.ts).
  const focus = selectFocusFilesByGraph("corrija a funcao shared", tie, 1);
  assert.deepEqual(focus, ["src/core.ts"]);
});
