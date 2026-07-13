import assert from "node:assert/strict";
import test from "node:test";
import { renderTaskLog, taskLogFileName } from "../src/memory/taskLog";

test("task log uses versionable timestamped markdown format", () => {
  const log = {
    id: "task-1",
    title: "Criar memoria compartilhada",
    date: "2026-06-15T12:34:00.000Z",
    tool: "adonex",
    status: "completed",
    objective: "Persist project memory",
    context: ["AGENTS.md"],
    plan: ["Create module"],
    filesRead: ["README.md"],
    filesChanged: ["src/memory/types.ts"],
    commandsRun: ["npm test"],
    decisions: ["Repository is source of truth"],
    problems: [],
    result: "Implemented",
    nextSteps: ["Package extension"]
  };
  assert.equal(
    taskLogFileName(log),
    "2026-06-15_12-34_criar-memoria-compartilhada.md"
  );
  const markdown = renderTaskLog(log);
  assert.match(markdown, /^---/);
  assert.match(markdown, /## Arquivos alterados/);
  assert.match(markdown, /Repository is source of truth/);
});
