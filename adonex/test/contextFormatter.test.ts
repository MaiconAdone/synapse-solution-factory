import assert from "node:assert/strict";
import test from "node:test";
import { formatWorkspaceSnapshot } from "../src/context/contextFormatter";

test("local context formatter enforces the total prompt budget", () => {
  const formatted = formatWorkspaceSnapshot(
    {
      root: "C:/workspace",
      stack: ["Python", "FastAPI", "React"],
      synapseDetected: true,
      synapseConfidence: 1,
      synapseSignals: ["runtime-manifest"],
      structure: Array.from({ length: 250 }, (_, index) => `src/file-${index}.ts`),
      relevantFiles: Array.from({ length: 8 }, (_, index) => ({
        path: `src/file-${index}.ts`,
        content: "x".repeat(4_000),
        redacted: false,
        score: 10,
        reasons: ["task-term:error"]
      })),
      estimatedTokens: 10_000,
      sharedMemory: "memory".repeat(2_000)
    },
    12_000
  );
  assert.ok(formatted.length <= 12_000);
  assert.match(formatted, /Synapse workspace: yes/);
});
