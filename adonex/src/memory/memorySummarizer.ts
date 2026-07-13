import type { MemoryBundle, MemoryUpdate } from "./types";

export function summarizeMemory(bundle: MemoryBundle, maxChars = 8_000): string {
  return [
    "## Current State",
    bundle.currentState,
    "## Agent Context",
    bundle.agentContext,
    "## Open Issues",
    bundle.openIssues,
    "## Tech Stack",
    bundle.techStack
  ]
    .join("\n\n")
    .slice(0, maxChars);
}

export function inferUpdateFromText(
  summary: string,
  filesChanged: string[],
  source: MemoryUpdate["source"]
): MemoryUpdate {
  const lines = summary.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return {
    summary: summary.slice(0, 12_000),
    filesChanged,
    decisionsAdded: pick(lines, /decision|decisao|architecture/i),
    issuesOpened: pick(lines, /issue|pending|pendencia|risk|risco/i),
    issuesResolved: pick(lines, /resolved|fixed|corrig/i),
    nextSteps: pick(lines, /next|proxim/i),
    source
  };
}

function pick(lines: string[], pattern: RegExp): string[] {
  return lines.filter((line) => pattern.test(line)).slice(0, 8);
}
