import type { McpToolDefinition } from "../../mcp/mcpServer";
import type { ProposedPatchOperation } from "../../llm/types";

export type ToolLoopToolName =
  | "read_file"
  | "search_files"
  | "list_files"
  | "edit_file"
  | "run_command"
  | "finish";

export const TOOL_LOOP_TOOL_NAMES = new Set<ToolLoopToolName>([
  "read_file",
  "search_files",
  "list_files",
  "edit_file",
  "run_command",
  "finish"
]);

/**
 * Decisao de um turno do Tool Loop. Frouxo de proposito (como o
 * PROPOSAL_JSON_SCHEMA de agent/proposalParser.ts): validar demais faz
 * modelos locais pequenos travarem ou degradarem a saida.
 */
export interface ToolLoopDecision {
  tool: ToolLoopToolName;
  thought?: string;
  path?: string;
  query?: string;
  operation?: ProposedPatchOperation;
  command?: string;
  summary?: string;
  commands?: string[];
}

export interface ToolLoopStep {
  index: number;
  tool: ToolLoopToolName;
  argsSummary: string;
  resultSummary: string;
  ok: boolean;
  timestamp: string;
}

export interface ToolExecutionResult {
  ok: boolean;
  summary: string;
  detail?: string;
}

/** Ferramenta do loop: estruturalmente compativel com McpToolDefinition. */
export interface ToolLoopTool extends McpToolDefinition {
  parameters: object;
}

/**
 * JSON Schema para structured outputs do Ollama (`format`). Um turno = uma
 * ferramenta OU finish; nunca as duas coisas.
 */
export const TOOL_LOOP_JSON_SCHEMA = {
  type: "object",
  properties: {
    tool: {
      type: "string",
      enum: ["read_file", "search_files", "list_files", "edit_file", "run_command", "finish"]
    },
    thought: { type: "string" },
    path: { type: "string" },
    query: { type: "string" },
    operation: { type: "object" },
    command: { type: "string" },
    summary: { type: "string" },
    commands: { type: "array", items: { type: "string" } }
  },
  required: ["tool"]
} as const;
