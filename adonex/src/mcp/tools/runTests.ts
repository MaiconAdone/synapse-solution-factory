import type { McpToolDefinition } from "../mcpServer";

export function runTestsTool(
  run: (command: string) => Promise<void>
): McpToolDefinition {
  return {
    name: "run_tests",
    description: "Request an approved test command in the VS Code terminal.",
    execute: async (input) => {
      const command = String((input as { command?: unknown })?.command ?? "");
      await run(command);
      return { started: true, command };
    }
  };
}
