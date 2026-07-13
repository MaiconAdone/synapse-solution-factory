import type { McpToolDefinition } from "../mcpServer";

export function analyzeArchitectureTool(
  analyze: (task: string) => Promise<string>
): McpToolDefinition {
  return {
    name: "analyze_architecture",
    description: "Analyze repository architecture with bounded context.",
    execute: async (input) => ({
      analysis: await analyze(String((input as { task?: unknown })?.task ?? ""))
    })
  };
}
