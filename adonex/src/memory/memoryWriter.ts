import { promises as fs } from "node:fs";
import path from "node:path";
import { scanAndRedactSecrets } from "../security/secretScanner";
import { MEMORY_PATHS } from "./memoryFiles";
import { renderTaskLog, taskLogFileName, timestampForPath } from "./taskLog";
import type {
  MemorySource,
  MemoryUpdate,
  ProjectMemoryState,
  TaskLog
} from "./types";

export class MemoryWriter {
  public constructor(private readonly root: string) {}

  public async appendDevelopmentLog(update: MemoryUpdate): Promise<void> {
    await this.append(
      MEMORY_PATHS.developmentLog,
      this.updateBlock("Development update", update)
    );
  }

  public async appendDecision(decision: string, source: MemorySource = "manual"): Promise<void> {
    const safe = this.safe(decision);
    await this.append(
      MEMORY_PATHS.decisions,
      `## ${this.iso()} [${source}]\n\n${safe}\n`
    );
    await this.append(
      MEMORY_PATHS.decisionsIndex,
      `| ${this.iso()} | ${oneLine(safe)} | Recorded by ${source} | Review project impact |\n`
    );
  }

  public async updateCurrentState(state: ProjectMemoryState | string): Promise<void> {
    const body =
      typeof state === "string"
        ? this.safe(state)
        : `# Current State

Last updated: ${this.iso()}

## Current Project State
${state.architectureSummary}

## Current Goal
${state.currentGoal}

## Current Phase
${state.currentPhase}

## Tech Stack
${state.techStack.map((item) => `- ${item}`).join("\n") || "- Unknown"}

## Active Tasks
${state.activeTasks.map((item) => `- ${item}`).join("\n") || "- None"}

## Open Problems
${state.openIssues.map((item) => `- ${item}`).join("\n") || "- None"}

## Important Decisions
${state.importantDecisions.map((item) => `- ${item}`).join("\n") || "- None"}
`;
    await this.writeControlled(MEMORY_PATHS.currentState, body);
  }

  public async appendOpenIssue(issue: string, source: MemorySource = "manual"): Promise<void> {
    const id = `ISSUE-${Date.now()}`;
    await this.append(
      MEMORY_PATHS.openIssues,
      `- [ ] ${id} | ${this.iso()} | ${source} | ${this.safe(issue)}\n`
    );
  }

  public async appendSharedDialogEntry(entry: {
    source: MemorySource;
    objective: string;
    status: string;
    notes?: string[];
  }): Promise<void> {
    const notes = (entry.notes ?? [])
      .map((note) => this.safe(note))
      .filter(Boolean)
      .slice(0, 6);
    await this.append(
      MEMORY_PATHS.sharedDialogMemory,
      [
        `## ${this.iso()} [${entry.source}] ${this.safe(entry.status)}`,
        "",
        `Objective: ${this.safe(entry.objective)}`,
        "",
        notes.length ? "Notes:" : "",
        ...notes.map((note) => `- ${note}`),
        ""
      ].filter((line) => line !== "").join("\n")
    );
  }

  public async appendChatTask(entry: {
    source: MemorySource;
    objective: string;
    status: string;
    notes?: string;
  }): Promise<void> {
    await this.append(
      MEMORY_PATHS.chatTasks,
      `| ${this.iso()} | ${this.safe(entry.source)} | ${this.safe(entry.status)} | ${oneLine(this.safe(entry.objective))} | ${oneLine(this.safe(entry.notes ?? ""))} |\n`
    );
  }

  public async resolveOpenIssue(issueId: string): Promise<boolean> {
    const target = this.target(MEMORY_PATHS.openIssues);
    const current = await fs.readFile(target, "utf8").catch(() => "");
    const lines = current.split(/\r?\n/);
    let resolved = false;
    const next = lines.map((line) => {
      if (!resolved && line.includes(issueId) && /- \[ \]/.test(line)) {
        resolved = true;
        return line.replace("- [ ]", "- [x]") + ` | resolved ${this.iso()}`;
      }
      return line;
    });
    if (resolved) await this.writeControlled(MEMORY_PATHS.openIssues, next.join("\n"));
    return resolved;
  }

  public async appendTaskLog(log: TaskLog): Promise<string> {
    const relativePath = await this.uniqueRelativePath(
      path.posix.join(".adonex/tasks", taskLogFileName(log))
    );
    await this.writeControlled(relativePath, renderTaskLog(this.safeTaskLog(log)));
    return relativePath;
  }

  public async appendAgentChangelog(update: MemoryUpdate): Promise<void> {
    await this.append(
      MEMORY_PATHS.agentChangelog,
      this.updateBlock("Agent change", update)
    );
  }

  public async createSnapshot(title: string, content = ""): Promise<string> {
    const relativePath = await this.uniqueRelativePath(
      `.adonex/snapshots/${timestampForPath(new Date())}_snapshot.md`
    );
    await this.writeControlled(
      relativePath,
      `# ${this.safe(title)}\n\nCreated: ${this.iso()}\n\n${this.safe(content)}\n`
    );
    return relativePath;
  }

  public async updateProjectMemory(section: string, content: string): Promise<void> {
    await this.append(
      MEMORY_PATHS.projectMemory,
      `## ${this.safe(section)}\n\n${this.safe(content)}\n`
    );
  }

  public async writeHandoff(relativePath: string, content: string): Promise<void> {
    if (!relativePath.startsWith(".adonex/handoff/")) {
      throw new Error("Handoff writes must remain under .adonex/handoff.");
    }
    await this.writeControlled(relativePath, content);
  }

  private async append(relativePath: string, content: string): Promise<void> {
    const target = this.target(relativePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.appendFile(target, `\n${this.safe(content)}`, "utf8");
  }

  private async writeControlled(relativePath: string, content: string): Promise<void> {
    const target = this.target(relativePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, this.safe(content), "utf8");
  }

  private updateBlock(title: string, update: MemoryUpdate): string {
    return `## ${this.iso()} - ${title} [${update.source}]

${this.safe(update.summary)}

- Files changed: ${update.filesChanged.join(", ") || "none"}
- Decisions: ${update.decisionsAdded.join("; ") || "none"}
- Issues opened: ${update.issuesOpened.join("; ") || "none"}
- Issues resolved: ${update.issuesResolved.join("; ") || "none"}
- Next steps: ${update.nextSteps.join("; ") || "none"}
`;
  }

  private safeTaskLog(log: TaskLog): TaskLog {
    const list = (values: string[]): string[] =>
      values.map((value) => this.safe(value));
    return {
      ...log,
      id: this.safe(log.id),
      title: this.safe(log.title),
      tool: this.safe(log.tool),
      status: this.safe(log.status),
      objective: this.safe(log.objective),
      context: list(log.context),
      plan: list(log.plan),
      filesRead: list(log.filesRead),
      filesChanged: list(log.filesChanged),
      commandsRun: list(log.commandsRun),
      decisions: list(log.decisions),
      problems: list(log.problems),
      result: this.safe(log.result),
      nextSteps: list(log.nextSteps)
    };
  }

  private safe(value: string): string {
    return scanAndRedactSecrets(value).redacted;
  }

  private target(relativePath: string): string {
    const target = path.resolve(this.root, relativePath);
    const root = path.resolve(this.root);
    if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
      throw new Error("Memory path escaped the workspace.");
    }
    return target;
  }

  private async uniqueRelativePath(relativePath: string): Promise<string> {
    const extension = path.posix.extname(relativePath);
    const stem = relativePath.slice(0, -extension.length);
    for (let index = 0; index < 1000; index += 1) {
      const candidate = index === 0 ? relativePath : `${stem}_${index}${extension}`;
      try {
        await fs.access(this.target(candidate));
      } catch {
        return candidate;
      }
    }
    throw new Error("Unable to allocate a unique memory history path.");
  }

  private iso(): string {
    return new Date().toISOString();
  }
}

function oneLine(value: string): string {
  return value.replace(/\|/g, "/").replace(/\s+/g, " ").slice(0, 240);
}
