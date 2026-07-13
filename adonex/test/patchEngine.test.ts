import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
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
