import assert from "node:assert/strict";
import test from "node:test";
import { formatTaskResult } from "../src/chat/taskResultFormatter";
import type { TaskRecord } from "../src/llm/types";

test("autonomous task result is formatted for the same VS Code chat", () => {
  const record: TaskRecord = {
    id: "task-1",
    createdAt: "2026-06-15T00:00:00.000Z",
    updatedAt: "2026-06-15T00:00:00.000Z",
    status: "completed",
    objective: "verificar Synapse",
    action: "test",
    mode: "synapse",
    selectedFiles: [],
    plan: {
      id: "task-1",
      action: "test",
      mode: "synapse",
      objective: "verificar Synapse",
      filesToRead: [],
      filesToChange: [],
      commands: ["npm run check"],
      risks: [],
      estimatedInputTokens: 1,
      estimatedOutputTokens: 1,
      estimatedCostUsd: 0,
      requiresApproval: false
    },
    commands: ["npm run check"],
    commandResults: [
      {
        command: "npm run check",
        exitCode: 0,
        stdout: "ok",
        stderr: "",
        durationMs: 100,
        timedOut: false
      }
    ],
    cost: {
      estimatedInputTokens: 1,
      estimatedOutputTokens: 1,
      estimatedCostUsd: 0,
      actualInputTokens: 0,
      actualOutputTokens: 0,
      actualEstimatedCostUsd: 0
    },
    finalSummary: "Validacao aprovada."
  };
  const output = formatTaskResult(record);
  assert.match(output, /Resultado do AdoneX/);
  assert.match(output, /npm run check/);
  assert.match(output, /Validacao aprovada/);
});
