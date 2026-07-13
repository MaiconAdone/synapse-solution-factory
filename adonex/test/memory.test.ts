import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { MemoryInitializer } from "../src/memory/memoryInitializer";
import { MEMORY_PATHS } from "../src/memory/memoryFiles";
import { MemoryReader } from "../src/memory/memoryReader";
import { MemoryWriter } from "../src/memory/memoryWriter";

test("memory initializer creates required files and preserves existing content", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "adonex-memory-"));
  await fs.writeFile(path.join(root, "AGENTS.md"), "# Existing rules\n", "utf8");
  const initializer = new MemoryInitializer(root);
  const first = await initializer.initialize();
  const second = await initializer.initialize();

  assert.ok(first.created.includes(MEMORY_PATHS.currentState));
  assert.ok(first.preserved.includes(MEMORY_PATHS.agents));
  assert.ok(second.preserved.includes(MEMORY_PATHS.currentState));
  assert.equal(await fs.readFile(path.join(root, "AGENTS.md"), "utf8"), "# Existing rules\n");
  await fs.rm(root, { recursive: true, force: true });
});

test("memory writer redacts secrets before appending versioned memory", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "adonex-memory-"));
  await new MemoryInitializer(root).initialize();
  await new MemoryWriter(root).appendOpenIssue(
    "Leaked token api_key=super-secret-value"
  );
  const issues = await new MemoryReader(root).readOpenIssues();

  assert.doesNotMatch(issues, /super-secret-value/);
  assert.match(issues, /\[REDACTED:Generic secret\]/);
  await fs.rm(root, { recursive: true, force: true });
});

test("core memory reader returns repository-backed agent rules and state", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "adonex-memory-"));
  await new MemoryInitializer(root).initialize();
  const core = await new MemoryReader(root).readCoreMemory();

  assert.match(core, /AGENTS\.md/);
  assert.match(core, /CURRENT_STATE\.md/);
  assert.match(core, /CODING_STANDARDS\.md/);
  await fs.rm(root, { recursive: true, force: true });
});

test("shared dialog memory is initialized and read by assistant prompts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "adonex-memory-"));
  await new MemoryInitializer(root).initialize();
  await new MemoryWriter(root).appendSharedDialogEntry({
    source: "vscode-chat",
    objective: "Criar projeto IA/RAG para atendimento",
    status: "waiting-for-user",
    notes: ["missing=risk_level"]
  });
  await new MemoryWriter(root).appendChatTask({
    source: "vscode-chat",
    objective: "Criar projeto IA/RAG para atendimento",
    status: "waiting-for-user",
    notes: "missing=risk_level"
  });

  const reader = new MemoryReader(root);
  const adonexMemory = await reader.readForAdoneXPrompt();
  const codexMemory = await reader.readForCodexHandoff();

  assert.match(adonexMemory, /SHARED_DIALOG_MEMORY\.md/);
  assert.match(adonexMemory, /CHAT_TASKS\.md/);
  assert.match(codexMemory, /Criar projeto IA\/RAG/);
  assert.match(codexMemory, /missing=risk_level/);
  await fs.rm(root, { recursive: true, force: true });
});

test("task history never overwrites a same-minute record", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "adonex-memory-"));
  await new MemoryInitializer(root).initialize();
  const writer = new MemoryWriter(root);
  const task = {
    id: "same-minute",
    title: "Repeated task",
    date: "2026-06-15T12:34:00.000Z",
    tool: "adonex",
    status: "completed",
    objective: "Preserve history",
    context: [],
    plan: [],
    filesRead: [],
    filesChanged: [],
    commandsRun: [],
    decisions: [],
    problems: [],
    result: "Done",
    nextSteps: []
  };
  const first = await writer.appendTaskLog(task);
  const second = await writer.appendTaskLog(task);
  assert.notEqual(first, second);
  await fs.rm(root, { recursive: true, force: true });
});
