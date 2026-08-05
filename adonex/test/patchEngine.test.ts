import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  applyOperationsToContents,
  applyPatchOperation,
  createSimpleDiff,
  detectHighRiskRewrites,
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

test("patch engine diff only marks the line that actually changed, not the whole file", () => {
  const lines = Array.from({ length: 50 }, (_, index) => `line ${index}`);
  const before = lines.join("\n");
  const after = lines
    .map((line, index) => (index === 25 ? "line 25 edited" : line))
    .join("\n");
  const diff = createSimpleDiff("src/big.ts", before, after);
  const removed = diff.split("\n").filter((line) => line.startsWith("-") && !line.startsWith("---"));
  const added = diff.split("\n").filter((line) => line.startsWith("+") && !line.startsWith("+++"));
  assert.deepEqual(removed, ["-line 25"]);
  assert.deepEqual(added, ["+line 25 edited"]);
  // A edicao cirurgica de 1 linha nao pode inflar o diff para o arquivo inteiro
  // (o dump antigo produziria 50 linhas removidas + 50 adicionadas aqui).
  assert.match(diff, /^ line 0$/m);
  assert.match(diff, /^ line 49$/m);
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

test("detectHighRiskRewrites flags whole-file rewrites that remove most lines", () => {
  const before = ["a", "b", "c", "d", "e", "f", "g", "h"].join("\n");
  const risks = detectHighRiskRewrites(
    [{ path: "src/app.ts", content: "a\nb" }],
    new Map([["src/app.ts", before]])
  );
  assert.equal(risks.length, 1);
  assert.equal(risks[0].path, "src/app.ts");
  assert.equal(risks[0].beforeLines, 8);
  assert.equal(risks[0].afterLines, 2);
  assert.equal(risks[0].removedPercent, 75);
});

test("detectHighRiskRewrites ignores new files, tiny files and safe rewrites", () => {
  // Arquivo novo (sem conteudo atual): nunca e risco.
  assert.equal(
    detectHighRiskRewrites([{ path: "new.ts", content: "x" }], new Map()).length,
    0
  );
  // Arquivo pequeno demais para a guarda.
  assert.equal(
    detectHighRiskRewrites(
      [{ path: "tiny.ts", content: "" }],
      new Map([["tiny.ts", "a\nb"]])
    ).length,
    0
  );
  // Rewrite que preserva a maioria das linhas.
  const before = ["a", "b", "c", "d", "e", "f"].join("\n");
  assert.equal(
    detectHighRiskRewrites(
      [{ path: "src/app.ts", content: ["a", "b", "c", "d", "e", "f", "g"].join("\n") }],
      new Map([["src/app.ts", before]])
    ).length,
    0
  );
});

test("detectHighRiskRewrites does not flag removals exactly at the threshold", () => {
  const before = ["a", "b", "c", "d", "e", "f", "g", "h"].join("\n");
  assert.equal(
    detectHighRiskRewrites(
      [{ path: "src/app.ts", content: "a\nb\nc\nd" }],
      new Map([["src/app.ts", before]])
    ).length,
    0
  );
});

test("patch operations tolerate indentation drift via normalized anchor matching", () => {
  const current = "function main() {\n    console.log('hi');\n}\n";
  const result = applyPatchOperation(current, {
    type: "replace",
    path: "src/app.ts",
    expected: "console.log('hi');",
    replacement: "console.log('bye');"
  });
  // O replacement e realinhado com a indentacao do trecho encontrado.
  assert.equal(result, "function main() {\n    console.log('bye');\n}\n");
});

test("patch operations reindent multi-line replacements to the matched anchor", () => {
  const current = "if (ok) {\n  run();\n}\n";
  const result = applyPatchOperation(current, {
    type: "replace",
    path: "src/app.ts",
    // Indentacao divergente do arquivo (4 espacos vs 2): forca o estagio
    // normalizado, que realinha o replacement com a indentacao do arquivo.
    expected: "    run();",
    replacement: "run();\nvalidate();"
  });
  assert.equal(result, "if (ok) {\n  run();\n  validate();\n}\n");
});

test("patch operations fall back to fuzzy matching for slightly altered anchors", () => {
  const current = [
    "const timeout = 30;",
    "const retries = 3;",
    "connect(timeout, retries);"
  ].join("\n");
  const result = applyPatchOperation(current, {
    type: "replace",
    path: "src/app.ts",
    expected: "const timeout = 30;\nconst retries = 5;\nconnect(timeout, retries);",
    replacement: "const retries = 5;"
  });
  assert.equal(result, "const retries = 5;");
});

test("fuzzy matching refuses anchors with more than one similar candidate", () => {
  // Duas janelas identicas e muito parecidas com o anchor: empate no fuzzy
  // aborta em vez de aplicar no trecho errado.
  const current = "apply_config(mode);\napply_config(mode);\n";
  assert.throws(
    () =>
      applyPatchOperation(current, {
        type: "replace",
        path: "src/app.ts",
        expected: "apply_config(fast);",
        replacement: "apply_config(safe);"
      }),
    /ambiguous/
  );
});

test("normalized matching refuses anchors ambiguous after whitespace normalization", () => {
  const current = "  run();\n    run();\n";
  assert.throws(
    () =>
      applyPatchOperation(current, {
        type: "replace",
        path: "src/app.ts",
        expected: "run();",
        replacement: "stop();"
      }),
    /ambiguous/
  );
});

test("insert_before and insert_after tolerate indentation drift too", () => {
  const current = "function main() {\n    work();\n}\n";
  // Anchor com indentacao divergente (2 espacos vs 4 no arquivo): forca o
  // estagio normalizado, cujo span cobre a linha inteira.
  const before = applyPatchOperation(current, {
    type: "insert_before",
    path: "src/app.ts",
    anchor: "  work();",
    content: "start();\n"
  });
  assert.equal(before, "function main() {\nstart();\n    work();\n}\n");
  const after = applyPatchOperation(current, {
    type: "insert_after",
    path: "src/app.ts",
    anchor: "  work();",
    content: "\ndone();"
  });
  assert.equal(after, "function main() {\n    work();\ndone();\n}\n");
});
