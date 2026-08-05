import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRepairInput,
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
