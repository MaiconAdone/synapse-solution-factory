export interface McpToolDefinition {
  name: string;
  description: string;
  execute(input: unknown): Promise<unknown>;
}

export class AdoneXMcpRegistry {
  private readonly tools = new Map<string, McpToolDefinition>();

  public register(tool: McpToolDefinition): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`MCP tool already registered: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
  }

  public list(): Array<Pick<McpToolDefinition, "name" | "description">> {
    return [...this.tools.values()].map(({ name, description }) => ({
      name,
      description
    }));
  }

  public async call(name: string, input: unknown): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Unknown MCP tool: ${name}`);
    return tool.execute(input);
  }
}

// Transport binding is intentionally deferred. The registry keeps tool contracts
// independent from stdio, HTTP, or a future VS Code MCP API.
