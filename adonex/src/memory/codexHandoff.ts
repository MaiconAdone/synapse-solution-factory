import { promises as fs } from "node:fs";
import path from "node:path";
import { WorkspaceContext } from "../context/workspaceContext";
import { scanAndRedactSecrets } from "../security/secretScanner";
import { MEMORY_PATHS } from "./memoryFiles";
import { MemoryReader } from "./memoryReader";
import { MemoryWriter } from "./memoryWriter";
import type { CodexHandoff } from "./types";

export class CodexHandoffService {
  public constructor(
    private readonly root: string,
    private readonly maxFileChars = 8_000
  ) {}

  public async generate(objective: string): Promise<string> {
    const reader = new MemoryReader(this.root, this.maxFileChars);
    const workspace = await new WorkspaceContext().collect(objective);
    const handoff: CodexHandoff = {
      taskTitle: objective.slice(0, 120),
      objective,
      currentState: await reader.readCurrentState(),
      relevantFiles: workspace.relevantFiles.map((file) => file.path).slice(0, 8),
      constraints: [
        "Preserve existing project memory and unrelated user changes.",
        "Use focused context and the existing project architecture.",
        "Do not write or run commands without explicit approval.",
        "Keep Codex context economical: read only files needed for the current task.",
        "Do not activate Ruflo or all 60 agents inside Codex unless explicitly requested by the user.",
        "For Synapse solution creation or implementation, work through the VS Code chat/dialog flow; do not require a browser.",
        "If project goal, business problem, universe, success metric, data/knowledge sources, or risk level is missing, ask the user before implementing.",
        "After the briefing is complete, consult BusinessSolutionAnalyzer and use config/business_solution_analysis.json as the architecture decision record."
      ],
      codingStandards: await reader.readCodingStandards(),
      safetyRules: [
        "Never read, expose, or modify .env, credentials, API keys, tokens, passwords, or private keys.",
        "Redact suspected secrets.",
        "Do not delete memory history.",
        "Do not modify sensitive files."
      ],
      expectedOutput: [
        "Implement the requested change.",
        "Run the smallest relevant validation.",
        "Summarize files changed, commands, decisions, problems, and next steps.",
        "Avoid broad architecture dumps unless they directly support the change."
      ],
      memoryFilesToRead: [
        "AGENTS.md",
        "CLAUDE.md",
        "config/llm_solution_factory_policy.json",
        "docs/specifications/llm_solution_factory_governance.md",
        ".adonex/memory/AGENT_CONTEXT.md",
        ".adonex/memory/CURRENT_STATE.md",
        ".adonex/memory/SHARED_DIALOG_MEMORY.md",
        ".adonex/memory/CHAT_TASKS.md",
        ".adonex/memory/OPEN_ISSUES.md"
      ],
      postExecutionInstructions: [
        "Write the technical result to .adonex/handoff/CODEX_RESULT.md.",
        "Do not erase or rewrite historical memory logs.",
        "Leave memory synchronization to AdoneX after execution."
      ]
    };
    const content = renderCodexHandoff(handoff, await reader.readForCodexHandoff());
    await new MemoryWriter(this.root).writeHandoff(MEMORY_PATHS.codexPrompt, content);
    await new MemoryWriter(this.root).writeHandoff(
      MEMORY_PATHS.lastHandoff,
      `# Last Handoff\n\nGenerated: ${new Date().toISOString()}\n\nObjective: ${objective}\n`
    );
    return path.join(this.root, MEMORY_PATHS.codexPrompt);
  }

  public async readResult(): Promise<string> {
    const content = await fs
      .readFile(path.join(this.root, MEMORY_PATHS.codexResult), "utf8")
      .catch(() => "");
    return scanAndRedactSecrets(content.slice(0, this.maxFileChars)).redacted;
  }
}

export function renderCodexHandoff(
  handoff: CodexHandoff,
  sharedMemory: string
): string {
  return `# Codex Handoff: ${handoff.taskTitle}

Generated: ${new Date().toISOString()}

## Objective

${handoff.objective}

## Shared Project Memory

${sharedMemory}

## Current State

${handoff.currentState}

## Relevant Files

${list(handoff.relevantFiles)}

## Constraints

${list(handoff.constraints)}

## Coding Standards

${handoff.codingStandards}

## Safety Rules

${list(handoff.safetyRules)}

## Expected Steps And Output

${list(handoff.expectedOutput)}

## Memory Files To Read First

${list(handoff.memoryFilesToRead)}

## Post-Execution Instructions

${list(handoff.postExecutionInstructions)}
`;
}

function list(values: string[]): string {
  return values.map((value) => `- ${value}`).join("\n");
}
