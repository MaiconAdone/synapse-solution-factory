import type { McpToolDefinition } from "../mcpServer";

export function readProjectStructureTool(
  read: () => Promise<string[]>
): McpToolDefinition {
  return {
    name: "read_project_structure",
    description: "Return the bounded, non-sensitive workspace structure.",
    execute: async () => ({ files: await read() })
  };
}
