export type AgentMode =
  | "economic"
  | "balanced"
  | "strong"
  | "local"
  | "synapse";

export type AgentAction =
  | "chat"
  | "plan"
  | "implement"
  | "review"
  | "test"
  | "document"
  | "explain"
  | "synapse_explain"
  | "fix"
  | "commit"
  | "synapse_architecture"
  | "synapse_agent"
  | "synapse_mcp"
  | "synapse_pipeline"
  | "synapse_roadmap";

export interface LlmRequest {
  systemPrompt: string;
  userPrompt: string;
  workspaceContext?: string;
  model?: string;
  maxOutputTokens?: number;
  signal?: AbortSignal;
  jsonMode?: boolean;
  seed?: number;
}

export interface LlmResponse {
  provider: "openai" | "ollama";
  model: string;
  text: string;
  inputTokens: number;
  outputTokens: number;
}

export interface ProposedFileChange {
  path: string;
  content: string;
}

export type ProposedPatchOperation =
  | {
      type: "replace";
      path: string;
      expected: string;
      replacement: string;
    }
  | {
      type: "insert_before" | "insert_after";
      path: string;
      anchor: string;
      content: string;
    }
  | {
      type: "append";
      path: string;
      content: string;
    }
  | {
      type: "delete";
      path: string;
      expected: string;
    };

export interface GeneratedPatch {
  diff: string;
  changes: ProposedFileChange[];
  operations?: ProposedPatchOperation[];
}

export interface AppliedPatchEntry {
  path: string;
  existed: boolean;
  beforeContent?: string;
}

export interface AppliedPatchReceipt {
  appliedAt: string;
  entries: AppliedPatchEntry[];
}

export interface CommandResult {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

export interface FailureDiagnosis {
  command: string;
  category: "test_failure" | "typecheck" | "dependency" | "timeout" | "runtime" | "unknown";
  probableCause: string;
  evidence: string;
  nextAction: string;
}

export interface TaskPlan {
  id: string;
  action: AgentAction;
  mode: AgentMode;
  objective: string;
  filesToRead: string[];
  filesToChange: string[];
  commands: string[];
  risks: string[];
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedCostUsd: number;
  requiresApproval: boolean;
  recommendedExecution?: "adonex-local" | "adonex-openai" | "codex-recommended";
}

export interface ImplementationProposal {
  summary: string;
  changes: ProposedFileChange[];
  operations?: ProposedPatchOperation[];
  commands: string[];
}

export interface TaskCost {
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedCostUsd: number;
  actualInputTokens: number;
  actualOutputTokens: number;
  actualEstimatedCostUsd: number;
}

export type TaskStatus =
  | "planned"
  | "approved"
  | "proposed"
  | "awaiting_patch_confirmation"
  | "patch_applied"
  | "patch_reverted"
  | "validating"
  | "tests_passed"
  | "tests_failed"
  | "fix_proposed"
  | "completed"
  | "cancelled"
  | "rejected"
  | "failed";

export type TaskLifecyclePhase =
  | "plan"
  | "context"
  | "act"
  | "observe"
  | "patch"
  | "test"
  | "repair"
  | "finalize";

export type TaskLifecycleState = "pending" | "active" | "completed" | "blocked" | "skipped";

export interface TaskLifecycleStep {
  phase: TaskLifecyclePhase;
  title: string;
  state: TaskLifecycleState;
  detail?: string;
  updatedAt: string;
}

export interface TaskRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: TaskStatus;
  objective: string;
  action: AgentAction;
  mode: AgentMode;
  selectedFiles: Array<{ path: string; score: number; reasons: string[] }>;
  plan: TaskPlan;
  provider?: string;
  model?: string;
  proposalSummary?: string;
  patchDiff?: string;
  spokenDiffSummary?: string;
  appliedPatch?: AppliedPatchReceipt;
  commands: string[];
  commandResults: CommandResult[];
  cost: TaskCost;
  finalSummary?: string;
  commitSuggestion?: string;
  failureDiagnosis?: FailureDiagnosis;
  error?: string;
  lifecycle?: TaskLifecycleStep[];
}

export interface WorkspaceSnapshot {
  root: string;
  stack: string[];
  synapseDetected: boolean;
  synapseConfidence: number;
  synapseSignals: string[];
  structure: string[];
  relevantFiles: Array<{
    path: string;
    content: string;
    redacted: boolean;
    score: number;
    reasons: string[];
  }>;
  estimatedTokens: number;
  sharedMemory?: string;
  codeIntelligence?: {
    taskKind: string;
    riskLevel: "low" | "medium" | "high";
    modelProfile: string;
    suggestedAgents: string[];
    relatedTests: string[];
    dependencyHints: Array<{
      path: string;
      imports: string[];
      exports: string[];
      declared: string[];
    }>;
    notes: string[];
  };
}
