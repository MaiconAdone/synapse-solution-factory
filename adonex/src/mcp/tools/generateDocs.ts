import type { McpToolDefinition } from "../mcpServer";

export function generateDocsTool(
  generate: (task: string) => Promise<string>
): McpToolDefinition {
  return {
    name: "generate_docs",
    description: "Generate repository-aware documentation without writing files.",
    execute: async (input) => ({
      documentation: await generate(
        String((input as { task?: unknown })?.task ?? "")
      )
    })
  };
}
