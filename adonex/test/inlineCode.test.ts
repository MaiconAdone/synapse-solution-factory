import assert from "node:assert/strict";
import test from "node:test";
import {
  boundFimWindow,
  buildFimPrompt,
  cleanFimCompletion,
  extractCodeBlock
} from "../src/inline/codeExtraction";

test("extractCodeBlock returns the largest fenced block", () => {
  const text = [
    "Aqui esta:",
    "```ts",
    "const a = 1;",
    "```",
    "e um menor",
    "```",
    "x",
    "```"
  ].join("\n");
  assert.equal(extractCodeBlock(text), "const a = 1;");
});

test("extractCodeBlock falls back to trimmed text without fences", () => {
  assert.equal(extractCodeBlock("  const a = 1;  "), "const a = 1;");
});

test("cleanFimCompletion strips FIM tokens and code fences", () => {
  const raw = "```\nconst a = 1;\n```<|fim_middle|>";
  assert.equal(cleanFimCompletion(raw, ""), "const a = 1;\n");
});

test("cleanFimCompletion avoids echoing the already-typed tail", () => {
  assert.equal(cleanFimCompletion("userName = value", "const user"), "Name = value");
});

test("boundFimWindow keeps text nearest the cursor", () => {
  const { prefix, suffix } = boundFimWindow("abcdef", "123456", 3, 2);
  assert.equal(prefix, "def");
  assert.equal(suffix, "12");
});

test("buildFimPrompt uses qwen tokens by default", () => {
  assert.equal(
    buildFimPrompt("A", "B"),
    "<|fim_prefix|>A<|fim_suffix|>B<|fim_middle|>"
  );
});
