import assert from "node:assert/strict";
import test from "node:test";
import {
  buildJudgeUserPrompt,
  formatJudgeWarning,
  JUDGE_JSON_SCHEMA,
  parseJudgeVerdict
} from "../src/agent/judgeAgent";
import type { TestWeakeningFinding } from "../src/composer/validationLoop";

test("schema requires verdict and reason with a fixed enum", () => {
  assert.deepEqual([...JUDGE_JSON_SCHEMA.required], ["verdict", "reason"]);
  assert.deepEqual(
    [...JUDGE_JSON_SCHEMA.properties.verdict.enum],
    ["fixes_root_cause", "weakens_test", "uncertain"]
  );
});

test("parseJudgeVerdict parses a clean verdict", () => {
  const result = parseJudgeVerdict(
    JSON.stringify({ verdict: "weakens_test", reason: "assert removido sem mudanca no codigo" })
  );
  assert.equal(result.verdict, "weakens_test");
  assert.match(result.reason, /assert removido/);
});

test("parseJudgeVerdict extracts verdict wrapped in prose and fences", () => {
  const text = [
    "Aqui esta:",
    "```json",
    '{"verdict":"fixes_root_cause","reason":"corrige a validacao de entrada"}',
    "```"
  ].join("\n");
  const result = parseJudgeVerdict(text);
  assert.equal(result.verdict, "fixes_root_cause");
});

test("parseJudgeVerdict fails closed to uncertain on empty output", () => {
  assert.equal(parseJudgeVerdict("").verdict, "uncertain");
  assert.equal(parseJudgeVerdict("   ").verdict, "uncertain");
});

test("parseJudgeVerdict fails closed to uncertain on malformed JSON", () => {
  assert.equal(parseJudgeVerdict("desculpe, nao sei").verdict, "uncertain");
});

test("parseJudgeVerdict fails closed to uncertain on unknown verdict value", () => {
  const result = parseJudgeVerdict(JSON.stringify({ verdict: "looks_fine", reason: "x" }));
  assert.equal(result.verdict, "uncertain");
});

test("buildJudgeUserPrompt includes captured failure and both diffs", () => {
  const prompt = buildJudgeUserPrompt(
    "AssertionError: expected 2 to equal 3",
    [{ path: "test/add.test.ts", before: "assert.equal(add(1,2),3)", after: "" }],
    [{ path: "src/add.ts", before: "return a+b", after: "return a-b" }]
  );
  assert.match(prompt, /AssertionError: expected 2 to equal 3/);
  assert.match(prompt, /test\/add\.test\.ts/);
  assert.match(prompt, /src\/add\.ts/);
});

test("buildJudgeUserPrompt marks absence of production diffs", () => {
  const prompt = buildJudgeUserPrompt("erro", [{ path: "test/add.test.ts" }], []);
  assert.match(prompt, /nenhum arquivo de producao foi alterado/);
});

test("formatJudgeWarning combines finding reason and verdict", () => {
  const finding: TestWeakeningFinding = {
    path: "test/add.test.ts",
    reason: "numero de assertions caiu de 2 para 1",
    severity: "high"
  };
  const warning = formatJudgeWarning(finding, {
    verdict: "weakens_test",
    reason: "assert removido sem corrigir add()"
  });
  assert.match(warning, /^fable-judge:/);
  assert.match(warning, /test\/add\.test\.ts/);
  assert.match(warning, /veredito=weakens_test/);
});
