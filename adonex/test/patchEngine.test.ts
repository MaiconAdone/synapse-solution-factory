import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  applyOperationsToContents,
  applyPatchOperation,
  createSimpleDiff,
  resolveSafePath
} from "../src/patch/patchUtils";
import { summarizePatchForSpeech } from "../src/patch/patchSummary";

test("patch engine rejects workspace escape", () => {
  assert.throws(() => resolveSafePath(path.resolve("workspace"), "../secret.txt"));
});

test("patch engine creates a readable preview diff", () => {
  const diff = createSimpleDiff("src/app.ts", "old", "new");
  assert.match(diff, /--- a\/src\/app\.ts/);
  assert.match(diff, /@@ -1,1 \+1,1 @@/);
  assert.match(diff, /-old/);
  assert.match(diff, /\+new/);
});

test("patch operations apply incremental replacements with conflict checks", () => {
  const result = applyPatchOperation("const value = 1;\n", {
    type: "replace",
    path: "src/app.ts",
    expected: "const value = 1;",
    replacement: "const value = 2;"
  });

  assert.equal(result, "const value = 2;\n");
  assert.throws(
    () =>
      applyPatchOperation("const value = 1;\n", {
        type: "replace",
        path: "src/app.ts",
        expected: "const missing = true;",
        replacement: "const missing = false;"
      }),
    /Patch conflict/
  );
});

test("applyOperationsToContents chains operations per file over current content", () => {
  const current = new Map([["src/app.ts", "const a = 1;\nconst b = 2;\n"]]);
  const result = applyOperationsToContents(
    [
      {
        type: "replace",
        path: "src/app.ts",
        expected: "const a = 1;",
        replacement: "const a = 10;"
      },
      {
        type: "replace",
        path: "src/app.ts",
        expected: "const b = 2;",
        replacement: "const b = 20;"
      }
    ],
    current
  );
  assert.equal(result.get("src/app.ts"), "const a = 10;\nconst b = 20;\n");
});

test("applyOperationsToContents preserves simultaneous edits and flags conflicts", () => {
  // Edicao manual feita depois da proposta: a operation reaplica por cima do
  // conteudo atual, preservando a linha extra do usuario.
  const edited = new Map([["src/app.ts", "// user note\nconst a = 1;\n"]]);
  const result = applyOperationsToContents(
    [
      {
        type: "replace",
        path: "src/app.ts",
        expected: "const a = 1;",
        replacement: "const a = 2;"
      }
    ],
    edited
  );
  assert.equal(result.get("src/app.ts"), "// user note\nconst a = 2;\n");

  // Se a edicao manual removeu o trecho esperado, conflita em vez de sobrescrever.
  const conflicting = new Map([["src/app.ts", "const renamed = 1;\n"]]);
  assert.throws(
    () =>
      applyOperationsToContents(
        [
          {
            type: "replace",
            path: "src/app.ts",
            expected: "const a = 1;",
            replacement: "const a = 2;"
          }
        ],
        conflicting
      ),
    /Patch conflict/
  );
});

test("patch replace preserves dollar sequences literally", () => {
  const result = applyPatchOperation("const label = OLD;\n", {
    type: "replace",
    path: "src/app.ts",
    expected: "OLD",
    replacement: "`total: $${amount}`"
  });

  assert.equal(result, "const label = `total: $${amount}`;\n");
});

test("patch replace keeps regex backreferences from being interpreted", () => {
  const result = applyPatchOperation("x = MARK;\n", {
    type: "replace",
    path: "src/app.ts",
    expected: "MARK",
    replacement: "$&$1$`"
  });

  assert.equal(result, "x = $&$1$`;\n");
});

test("patch insert_after keeps dollar content literal", () => {
  const result = applyPatchOperation("run();\n", {
    type: "insert_after",
    path: "src/app.ts",
    anchor: "run();",
    content: "\nlog(`$${x}`);"
  });

  assert.equal(result, "run();\nlog(`$${x}`);\n");
});

test("patch operations reject ambiguous anchors", () => {
  assert.throws(
    () =>
      applyPatchOperation("run();\nrun();\n", {
        type: "insert_after",
        path: "src/app.ts",
        anchor: "run();",
        content: "\nvalidate();"
      }),
    /ambiguous/
  );
});

test("patch summary produces a short voice confirmation", () => {
  const summary = summarizePatchForSpeech({
    changes: [{ path: "src/app.ts", content: "new\n" }],
    diff: createSimpleDiff("src/app.ts", "old\n", "new\n")
  });

  assert.equal(summary.fileCount, 1);
  assert.ok(summary.addedLines >= 1);
  assert.match(summary.spoken, /Preparei uma alteracao/);
  assert.match(summary.spoken, /Diga ou clique em aplicar/);
});
