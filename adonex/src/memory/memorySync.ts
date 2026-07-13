import { randomUUID } from "node:crypto";
import path from "node:path";
import * as vscode from "vscode";
import { WorkspaceContext } from "../context/workspaceContext";
import { requestApproval } from "../security/approvalGate";
import { CodexHandoffService } from "./codexHandoff";
import { GitDiffReader } from "./gitDiffReader";
import { MEMORY_PATHS } from "./memoryFiles";
import { MemoryReader } from "./memoryReader";
import { inferUpdateFromText } from "./memorySummarizer";
import { MemoryWriter } from "./memoryWriter";
import type { MemoryUpdate, ProjectMemoryState, TaskLog } from "./types";

export class MemorySync {
  public constructor(
    private readonly root: string,
    private readonly maxDiffChars = 60_000,
    private readonly maxFileChars = 20_000
  ) {}

  public async syncFromWorkspace(requireApproval = true): Promise<string> {
    const workspace = await new WorkspaceContext().collect(
      "shared project memory current state architecture stack issues"
    );
    const reader = new MemoryReader(this.root, this.maxFileChars);
    const previous = await reader.readCurrentState();
    const state = this.workspaceState(workspace, previous);
    if (
      requireApproval &&
      !(await requestApproval(
        "Update AdoneX shared memory?",
        `Detected stack: ${workspace.stack.join(", ") || "unknown"}\nRelevant files: ${workspace.relevantFiles.length}\n\nCURRENT_STATE.md will be refreshed without deleting append-only history.`,
        "Update Memory"
      ))
    ) {
      throw new Error("Memory synchronization was rejected.");
    }
    const writer = new MemoryWriter(this.root);
    await writer.updateCurrentState(state);
    const update: MemoryUpdate = {
      summary: `Workspace memory synchronized for ${state.projectName}.`,
      filesChanged: [MEMORY_PATHS.currentState],
      decisionsAdded: [],
      issuesOpened: [],
      issuesResolved: [],
      nextSteps: state.activeTasks,
      source: "adonex"
    };
    await writer.appendDevelopmentLog(update);
    await writer.appendAgentChangelog(update);
    return `Memory synchronized. Stack: ${state.techStack.join(", ") || "unknown"}.`;
  }

  public async createSnapshot(): Promise<string> {
    const reader = new MemoryReader(this.root, this.maxFileChars);
    const workspace = await new WorkspaceContext().collect(
      "current project state stack decisions tasks open issues"
    );
    const tasks = await vscode.workspace.findFiles(
      new vscode.RelativePattern(this.root, ".adonex/tasks/*.md"),
      undefined,
      10
    );
    const content = [
      "## Current State",
      await reader.readCurrentState(),
      "## Detected Stack",
      workspace.stack.map((item) => `- ${item}`).join("\n"),
      "## Relevant Files",
      workspace.relevantFiles.map((file) => `- ${file.path}`).join("\n"),
      "## Decisions",
      (await reader.readAllMemory()).decisionsIndex,
      "## Recent Tasks",
      tasks.map((uri) => `- ${vscode.workspace.asRelativePath(uri)}`).join("\n"),
      "## Open Issues",
      await reader.readOpenIssues()
    ].join("\n\n");
    return new MemoryWriter(this.root).createSnapshot("AdoneX Project Snapshot", content);
  }

  public async importCodexResult(): Promise<string> {
    const handoff = new CodexHandoffService(this.root, this.maxFileChars);
    const result = await handoff.readResult();
    const git = new GitDiffReader(this.root, this.maxDiffChars);
    const changedFiles = await git.getChangedFiles();
    const diffSummary = await git.summarizeDiffForMemory();
    const sourceText = [result, diffSummary].filter(Boolean).join("\n\n");
    if (!sourceText.trim()) throw new Error("No CODEX_RESULT.md or Git diff was found.");
    if (
      !(await requestApproval(
        "Import Codex result into shared memory?",
        `Sources: ${result ? "CODEX_RESULT.md and Git diff" : "Git diff"}\nChanged files: ${changedFiles.length}`,
        "Import Result"
      ))
    ) {
      throw new Error("Codex result import was rejected.");
    }
    const update = inferUpdateFromText(sourceText, changedFiles, result ? "codex" : "git-diff");
    const writer = new MemoryWriter(this.root);
    await writer.updateCurrentState(renderImportedState(update));
    await writer.appendDevelopmentLog(update);
    await writer.appendAgentChangelog(update);
    for (const decision of update.decisionsAdded) await writer.appendDecision(decision, update.source);
    for (const issue of update.issuesOpened) await writer.appendOpenIssue(issue, update.source);
    const task: TaskLog = {
      id: randomUUID(),
      title: "Codex result import",
      date: new Date().toISOString(),
      tool: result ? "codex" : "git-diff",
      status: "completed",
      objective: "Import external implementation results into shared project memory.",
      context: [result ? MEMORY_PATHS.codexResult : "git diff"],
      plan: ["Read result", "Read bounded Git diff", "Update shared memory"],
      filesRead: [MEMORY_PATHS.codexResult],
      filesChanged: changedFiles,
      commandsRun: ["git status --short", "git diff --stat", "git diff --name-only", "git diff"],
      decisions: update.decisionsAdded,
      problems: update.issuesOpened,
      result: update.summary,
      nextSteps: update.nextSteps
    };
    const taskPath = await writer.appendTaskLog(task);
    return `Codex result imported. Task log: ${taskPath}`;
  }

  private workspaceState(
    workspace: Awaited<ReturnType<WorkspaceContext["collect"]>>,
    previous: string
  ): ProjectMemoryState {
    return {
      projectName: path.basename(workspace.root),
      detectedProjectType: workspace.synapseDetected ? "Synapse AI/ML" : "Software project",
      currentGoal: "Keep repository memory aligned with the current workspace.",
      currentPhase: "Active development",
      techStack: workspace.stack,
      architectureSummary: `Synapse detected: ${workspace.synapseDetected}. Signals: ${workspace.synapseSignals.join(", ") || "none"}.`,
      activeTasks: workspace.relevantFiles.slice(0, 8).map((file) => `Review ${file.path}`),
      openIssues: extractUnchecked(previous),
      importantDecisions: [],
      lastUpdatedAt: new Date().toISOString()
    };
  }
}

function extractUnchecked(content: string): string[] {
  return content
    .split(/\r?\n/)
    .filter((line) => /- \[ \]/.test(line))
    .slice(0, 8);
}

function renderImportedState(update: MemoryUpdate): string {
  return `# Current State

Last updated: ${new Date().toISOString()}
Source: ${update.source}

## Last Completed Task

${update.summary}

## Files Changed

${update.filesChanged.map((file) => `- ${file}`).join("\n") || "- None"}

## Open Problems

${update.issuesOpened.map((issue) => `- ${issue}`).join("\n") || "- None detected"}

## Next Steps

${update.nextSteps.map((step) => `- ${step}`).join("\n") || "- Review imported changes"}
`;
}
