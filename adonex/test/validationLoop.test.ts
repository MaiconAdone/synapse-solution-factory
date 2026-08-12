import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRepairInput,
  detectTestWeakening,
  diffDiagnosticsErrors,
  formatDiagnosticsAsFailure,
  selectValidationCommands
} from "../src/composer/validationLoop";
import type { CommandResult } from "../src/llm/types";

test("selectValidationCommands dedupes, drops review pseudo-commands and caps at three", () => {
  const commands = selectValidationCommands([
    "npm test",
    "Review the generated files manually",
    "npm test",
    "  npm run lint  ",
    "pytest -q",
    "npm run build"
  ]);
  assert.deepEqual(commands, ["npm test", "npm run lint", "pytest -q"]);
});

test("selectValidationCommands returns empty for review-only proposals", () => {
  assert.deepEqual(selectValidationCommands(["Review changes", "", "   "]), []);
});

const failed: CommandResult = {
  command: "npm test",
  exitCode: 1,
  stdout: "1 failing",
  stderr: "AssertionError: expected 2 to equal 3",
  durationMs: 1200,
  timedOut: false
};

test("buildRepairInput includes command, exit code and captured output", () => {
  const input = buildRepairInput(failed);
  assert.match(input, /Comando que falhou: npm test/);
  assert.match(input, /Exit code: 1/);
  assert.match(input, /1 failing/);
  assert.match(input, /AssertionError/);
});

test("buildRepairInput truncates long logs keeping the tail", () => {
  const noisy: CommandResult = {
    ...failed,
    stdout: "x".repeat(20_000),
    stderr: "final root cause line"
  };
  const input = buildRepairInput(noisy, 1_000);
  assert.ok(input.length < 1_500);
  assert.match(input, /saida truncada/);
  // A causa raiz no final do log e preservada.
  assert.match(input, /final root cause line/);
});

test("buildRepairInput handles empty captured output", () => {
  const silent: CommandResult = { ...failed, stdout: "", stderr: "" };
  assert.match(buildRepairInput(silent), /sem saida capturada/);
});

test("diffDiagnosticsErrors returns only new errors, deduplicated", () => {
  const before = [{ path: "a.ts", message: "old error", line: 1 }];
  const after = [
    { path: "a.ts", message: "old error", line: 1 },
    { path: "a.ts", message: "new error", line: 2 },
    { path: "a.ts", message: "new error", line: 2 },
    { path: "b.ts", message: "another", line: 5 }
  ];
  assert.deepEqual(diffDiagnosticsErrors(before, after), [
    { path: "a.ts", message: "new error", line: 2 },
    { path: "b.ts", message: "another", line: 5 }
  ]);
});

test("diffDiagnosticsErrors treats missing line as part of the key", () => {
  const after = [{ path: "a.ts", message: "err" }];
  assert.deepEqual(diffDiagnosticsErrors([], after), after);
  assert.deepEqual(
    diffDiagnosticsErrors([{ path: "a.ts", message: "err", line: 3 }], after),
    after
  );
});

test("formatDiagnosticsAsFailure caps the list and mentions the overflow", () => {
  const errors = Array.from({ length: 12 }, (_, index) => ({
    path: "a.ts",
    message: `e${index}`,
    line: index + 1
  }));
  const text = formatDiagnosticsAsFailure(errors, 10);
  assert.match(text, /12 erro\(s\) novo\(s\)/);
  assert.match(text, /mais 2 erro\(s\)/);
  assert.match(text, /a\.ts:1: e0/);
});

const originalTest = [
  "test('adds', () => {",
  "  assert.equal(add(1, 2), 3);",
  "  assert.equal(add(2, 2), 4);",
  "});"
].join("\n");

test("detectTestWeakening ignores non-test files", () => {
  assert.deepEqual(detectTestWeakening("src/add.ts", "a", "b"), []);
});

test("detectTestWeakening ignores unchanged test files", () => {
  assert.deepEqual(
    detectTestWeakening("test/add.test.ts", originalTest, originalTest),
    []
  );
});

test("detectTestWeakening flags fewer assertions", () => {
  const weakened = [
    "test('adds', () => {",
    "  assert.equal(add(1, 2), 3);",
    "});"
  ].join("\n");
  const findings = detectTestWeakening("test/add.test.ts", originalTest, weakened);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "high");
  assert.match(findings[0].reason, /assertions caiu de 2 para 1/);
});

test("detectTestWeakening flags fewer test cases", () => {
  const twoCases = [
    "test('adds', () => { assert.equal(add(1, 2), 3); });",
    "test('subtracts', () => { assert.equal(sub(2, 1), 1); });"
  ].join("\n");
  const oneCase = "test('adds', () => { assert.equal(add(1, 2), 3); });";
  const findings = detectTestWeakening("test/add.test.ts", twoCases, oneCase);
  assert.ok(findings.some((finding) => /casos de teste caiu de 2 para 1/.test(finding.reason)));
});

test("detectTestWeakening flags new skip/only", () => {
  const skipped = [
    "test.skip('adds', () => {",
    "  assert.equal(add(1, 2), 3);",
    "  assert.equal(add(2, 2), 4);",
    "});"
  ].join("\n");
  const findings = detectTestWeakening("test/add.test.ts", originalTest, skipped);
  assert.ok(findings.some((finding) => finding.severity === "medium"));
  assert.ok(findings.some((finding) => /skip\/only\/todo/.test(finding.reason)));
});

test("detectTestWeakening flags a deleted test file as high severity", () => {
  const findings = detectTestWeakening("test/add.test.ts", originalTest, "");
  assert.deepEqual(findings, [
    { path: "test/add.test.ts", reason: "arquivo de teste foi removido/esvaziado", severity: "high" }
  ]);
});

test("detectTestWeakening ignores brand new test files (no before)", () => {
  assert.deepEqual(detectTestWeakening("test/add.test.ts", undefined, originalTest), []);
});
