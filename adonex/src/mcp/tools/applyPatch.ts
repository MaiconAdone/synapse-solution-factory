import type { ProposedFileChange } from "../../llm/types";
import type { McpToolDefinition } from "../mcpServer";

export function applyPatchTool(
  apply: (changes: ProposedFileChange[]) => Promise<void>
): McpToolDefinition {
  return {
    name: "apply_patch",
    description: "Preview and apply approved workspace file changes.",
    execute: async (input) => {
      const changes = (input as { changes?: ProposedFileChange[] })?.changes ?? [];
      await apply(changes);
      return { applied: changes.length };
    }
  };
}
