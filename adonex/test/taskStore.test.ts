import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { TaskRecord } from "../src/llm/types";
import { diagnoseCommandFailure, finalizeTask } from "../src/tasks/taskFinalizer";
import { TaskStore } from "../src/tasks/taskStore";

test("task store persists lifecycle, selected files, and per-task cost", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "adonex-task-"));
  const store = new TaskStore(root);
  const now = new Date().toISOString();
  const record: TaskRecord = {
    id: "12345678-abcd",
    createdAt: now,
    updatedAt: now,
    status: "planned",
    objective: "Implement JWT authentication",
    action: "implement",
    mode: "balanced",
    selectedFiles: [
      { path: "src/auth.ts", score: 10, reasons: ["domain:auth"] }
    ],
    plan: {
      id: "12345678-abcd",
      action: "implement",
      mode: "balanced",
      objective: "Implement JWT authentication",
      filesToRead: ["src/auth.ts"],
      filesToChange: ["src/auth.ts"],
      commands: ["npm test"],
      risks: [],
      estimatedInputTokens: 100,
      estimatedOutputTokens: 50,
      estimatedCostUsd: 0.01,
      requiresApproval: true
    },
    commands: ["npm test"],
    commandResults: [],
    cost: {
      estimatedInputTokens: 100,
      estimatedOutputTokens: 50,
      estimatedCostUsd: 0.01,
      actualInputTokens: 90,
      actualOutputTokens: 40,
      actualEstimatedCostUsd: 0.008
    }
  };
  await store.save(record);
  const loaded = await store.load(record.id);
  assert.equal(loaded.selectedFiles[0].reasons[0], "domain:auth");
  assert.equal(loaded.cost.actualEstimatedCostUsd, 0.008);
});

test("task finalizer creates technical summary and commit suggestion", () => {
  const finalized = finalizeTask(
    {
      id: "12345678-abcd",
      action: "implement",
      mode: "local",
      objective: "Add captured test execution",
      filesToRead: [],
      filesToChange: ["src/execution/runner.ts"],
      commands: ["npm test"],
      risks: [],
      estimatedInputTokens: 10,
      estimatedOutputTokens: 10,
      estimatedCostUsd: 0,
      requiresApproval: true
    },
    {
      summary: "Added runner",
      changes: [{ path: "src/execution/runner.ts", content: "export {};" }],
      commands: ["npm test"]
    },
    [
      {
        command: "npm test",
        exitCode: 0,
        stdout: "ok",
        stderr: "",
        durationMs: 10,
        timedOut: false
      }
    ]
  );
  assert.match(finalized.summary, /Validacao aprovada/);
  assert.match(finalized.commitSuggestion, /^implement\(execution\):/);
});

test("task finalizer uses the latest retry result for each command", () => {
  const finalized = finalizeTask(
    {
      id: "retry",
      action: "test",
      mode: "synapse",
      objective: "validar projeto",
      filesToRead: [],
      filesToChange: [],
      commands: ["npm run check"],
      risks: [],
      estimatedInputTokens: 1,
      estimatedOutputTokens: 1,
      estimatedCostUsd: 0,
      requiresApproval: false
    },
    undefined,
    [
      {
        command: "npm run check",
        exitCode: 1,
        stdout: "",
        stderr: "failed",
        durationMs: 10,
        timedOut: false
      },
      {
        command: "npm run check",
        exitCode: 0,
        stdout: "passed",
        stderr: "",
        durationMs: 10,
        timedOut: false
      }
    ]
  );
  assert.match(finalized.summary, /Validacao aprovada/);
});

test("task finalizer diagnoses typecheck failures", () => {
  const diagnosis = diagnoseCommandFailure({
    command: "npm run compile",
    exitCode: 2,
    stdout: "",
    stderr: "src/app.ts(1,1): error TS2322: Type 'string' is not assignable",
    durationMs: 100,
    timedOut: false
  });

  assert.equal(diagnosis.category, "typecheck");
  assert.match(diagnosis.probableCause, /TypeScript/);
  assert.match(diagnosis.nextAction, /typecheck/);
});
