import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRepairInput,
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
