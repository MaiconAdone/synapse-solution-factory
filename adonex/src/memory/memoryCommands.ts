import { randomUUID } from "node:crypto";
import path from "node:path";
import * as vscode from "vscode";
import { WorkspaceContext } from "../context/workspaceContext";
import { CodexHandoffService } from "./codexHandoff";
import { MEMORY_PATHS } from "./memoryFiles";
import { ProjectMemory } from "./projectMemory";
import type { MemoryUpdate, TaskLog } from "./types";

export const MEMORY_COMMANDS = {
  init: "adonex.memory.init",
  open: "adonex.memory.open",
  readCurrentState: "adonex.memory.readCurrentState",
  sync: "adonex.memory.syncFromWorkspace",
  snapshot: "adonex.memory.snapshot",
  updateAfterTask: "adonex.memory.updateAfterTask",
  generateCodexPrompt: "adonex.handoff.generateCodexPrompt",
  importCodexResult: "adonex.handoff.importCodexResult",
  openCodexPrompt: "adonex.handoff.openCodexPrompt",
  openCodexResult: "adonex.handoff.openCodexResult",
  registerTask: "adonex.memory.registerTask",
  addDecision: "adonex.memory.addDecision",
  addIssue: "adonex.memory.addIssue",
  resolveIssue: "adonex.memory.resolveIssue",
  summary: "adonex.memory.summary"
} as const;

export function registerMemoryCommands(context: vscode.ExtensionContext): void {
  const register = (
    command: string,
    callback: (...args: unknown[]) => unknown
  ): void => {
    context.subscriptions.push(vscode.commands.registerCommand(command, callback));
  };

  register(MEMORY_COMMANDS.init, async () => {
    const memory = projectMemory();
    const result = await memory.initialize();
    const message = `Shared memory initialized. Created ${result.created.length}; preserved ${result.preserved.length}.`;
    void vscode.window.showInformationMessage(message);
    return message;
  });

  register(MEMORY_COMMANDS.open, () =>
    openWorkspaceFile(MEMORY_PATHS.projectMemory)
  );
  register(MEMORY_COMMANDS.readCurrentState, async () => {
    const state = await projectMemory().reader.readCurrentState();
    if (!state) return "Shared memory is not initialized. Run AdoneX: Initialize Shared Memory.";
    return state;
  });
  register(MEMORY_COMMANDS.summary, async () => {
    const memory = projectMemory();
    const bundle = await memory.reader.readAllMemory();
    return [
      bundle.projectMemory,
      bundle.currentState,
      bundle.sharedDialogMemory,
      bundle.chatTasks,
      bundle.openIssues
    ].filter(Boolean).join("\n\n").slice(0, 10_000) ||
      "Shared memory is not initialized.";
  });
  register(MEMORY_COMMANDS.sync, async () =>
    projectMemory().sync.syncFromWorkspace(true)
  );
  register(MEMORY_COMMANDS.snapshot, async () => {
    const relativePath = await projectMemory().sync.createSnapshot();
    await openWorkspaceFile(relativePath);
    return `Snapshot created: ${relativePath}`;
  });
  register(MEMORY_COMMANDS.updateAfterTask, async (provided?: unknown) => {
    const summary = await inputOrProvided(
      provided,
      "AdoneX: Update Memory After Task",
      "Summarize the completed task"
    );
    if (!summary) return "Memory update cancelled.";
    const update: MemoryUpdate = {
      summary,
      filesChanged: [],
      decisionsAdded: [],
      issuesOpened: [],
      issuesResolved: [],
      nextSteps: [],
      source: "manual"
    };
    const writer = projectMemory().writer;
    await writer.appendDevelopmentLog(update);
    await writer.appendAgentChangelog(update);
    return "Task outcome appended to shared memory.";
  });

  register(MEMORY_COMMANDS.generateCodexPrompt, async (provided?: unknown) => {
    const objective = await inputOrProvided(
      provided,
      "AdoneX: Generate Codex Handoff",
      "Describe the complex task for Codex"
    );
    if (!objective) return "Codex handoff cancelled.";
    const memory = projectMemory();
    await memory.initialize();
    const configuration = vscode.workspace.getConfiguration("adonex");
    if (configuration.get<boolean>("memory.createSnapshotBeforeCodexHandoff", true)) {
      await memory.sync.createSnapshot();
    }
    const target = await new CodexHandoffService(
      memory.root,
      configuration.get<number>("memory.maxFileChars", 8_000)
    ).generate(objective);
    await showDocument(vscode.Uri.file(target));
    return `Codex handoff generated: ${MEMORY_PATHS.codexPrompt}`;
  });
  register(MEMORY_COMMANDS.importCodexResult, async () =>
    projectMemory().sync.importCodexResult()
  );
  register(MEMORY_COMMANDS.openCodexPrompt, () =>
    openWorkspaceFile(MEMORY_PATHS.codexPrompt)
  );
  register(MEMORY_COMMANDS.openCodexResult, () =>
    openWorkspaceFile(MEMORY_PATHS.codexResult)
  );

  register(MEMORY_COMMANDS.registerTask, async (provided?: unknown) => {
    const title = await inputOrProvided(
      provided,
      "AdoneX: Register Task",
      "Task title and objective"
    );
    if (!title) return "Task registration cancelled.";
    const workspace = await new WorkspaceContext().collect(title);
    const task: TaskLog = {
      id: randomUUID(),
      title,
      date: new Date().toISOString(),
      tool: "manual",
      status: "recorded",
      objective: title,
      context: ["Manual task registration"],
      plan: [],
      filesRead: workspace.relevantFiles.map((file) => file.path),
      filesChanged: [],
      commandsRun: [],
      decisions: [],
      problems: [],
      result: "Task registered for project memory.",
      nextSteps: []
    };
    const taskPath = await projectMemory().writer.appendTaskLog(task);
    return `Task registered: ${taskPath}`;
  });
  register(MEMORY_COMMANDS.addDecision, async (provided?: unknown) => {
    const decision = await inputOrProvided(
      provided,
      "AdoneX: Record Decision",
      "Decision, reason, and expected impact"
    );
    if (!decision) return "Decision registration cancelled.";
    await projectMemory().writer.appendDecision(decision);
    return "Technical decision recorded.";
  });
  register(MEMORY_COMMANDS.addIssue, async (provided?: unknown) => {
    const issue = await inputOrProvided(
      provided,
      "AdoneX: Record Open Issue",
      "Bug, risk, debt, blocker, or pending question"
    );
    if (!issue) return "Issue registration cancelled.";
    await projectMemory().writer.appendOpenIssue(issue);
    return "Open issue recorded.";
  });
  register(MEMORY_COMMANDS.resolveIssue, async (provided?: unknown) => {
    const issueId = await inputOrProvided(
      provided,
      "AdoneX: Resolve Issue",
      "Issue id, for example ISSUE-123"
    );
    if (!issueId) return "Issue resolution cancelled.";
    return (await projectMemory().writer.resolveOpenIssue(issueId))
      ? `Issue ${issueId} resolved.`
      : `Issue ${issueId} was not found or was already resolved.`;
  });
}

function projectMemory(): ProjectMemory {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) throw new Error("Open a workspace before using shared memory.");
  const configuration = vscode.workspace.getConfiguration("adonex");
  if (!configuration.get<boolean>("memory.enabled", true)) {
    throw new Error("AdoneX shared memory is disabled in settings.");
  }
  return new ProjectMemory(
    root,
    configuration.get<number>("memory.maxDiffChars", 60_000),
    configuration.get<number>("memory.maxFileChars", 20_000)
  );
}

async function inputOrProvided(
  provided: unknown,
  title: string,
  prompt: string
): Promise<string | undefined> {
  if (typeof provided === "string" && provided.trim()) return provided.trim();
  return vscode.window.showInputBox({ title, prompt, ignoreFocusOut: true });
}

async function openWorkspaceFile(relativePath: string): Promise<string> {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!root) throw new Error("Open a workspace before opening memory.");
  const uri = vscode.Uri.joinPath(root, ...relativePath.split("/"));
  try {
    await showDocument(uri);
    return relativePath;
  } catch {
    throw new Error(`Memory file does not exist: ${relativePath}`);
  }
}

async function showDocument(uri: vscode.Uri): Promise<void> {
  const document = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(document, { preview: false });
}
