import type { WorkspaceSnapshot } from "../llm/types";

export function formatWorkspaceSnapshot(
  snapshot: WorkspaceSnapshot,
  maxChars = 48_000
): string {
  const header = [
    `Stack: ${snapshot.stack.join(", ") || "unknown"}`,
    `Synapse workspace: ${snapshot.synapseDetected ? "yes" : "no"}`,
    `Synapse confidence: ${snapshot.synapseConfidence}`,
    `Synapse signals: ${snapshot.synapseSignals.join(", ") || "none"}`
  ].join("\n");
  const memory = snapshot.sharedMemory
    ? `Shared project memory:\n${snapshot.sharedMemory}`
    : "Shared project memory: unavailable";
  const structure = `Structure:\n${snapshot.structure.slice(0, 80).join("\n")}`;
  const files = snapshot.relevantFiles
    .map(
      (file) =>
        `--- ${file.path} [score=${file.score}; ${file.reasons.join(", ")}]${
          file.redacted ? " [secrets redacted]" : ""
        }\n${file.content}`
    )
    .join("\n\n");
  return fitSections([header, memory, structure, `Relevant files:\n${files}`], maxChars);
}

export function fitSections(sections: string[], maxChars: number): string {
  const selected: string[] = [];
  let remaining = Math.max(0, maxChars);
  for (const section of sections) {
    if (remaining <= 0) break;
    const separator = selected.length ? 2 : 0;
    if (remaining <= separator) break;
    const value = section.slice(0, remaining - separator);
    selected.push(value);
    remaining -= value.length + separator;
  }
  return selected.join("\n\n");
}
