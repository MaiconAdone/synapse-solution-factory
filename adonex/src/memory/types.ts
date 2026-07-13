export type MemorySource =
  | "adonex"
  | "codex"
  | "claude"
  | "vscode-chat"
  | "manual"
  | "git-diff";

export interface ProjectMemoryState {
  projectName: string;
  detectedProjectType: string;
  currentGoal: string;
  currentPhase: string;
  techStack: string[];
  architectureSummary: string;
  activeTasks: string[];
  openIssues: string[];
  importantDecisions: string[];
  lastUpdatedAt: string;
}

export interface MemoryUpdate {
  summary: string;
  filesChanged: string[];
  decisionsAdded: string[];
  issuesOpened: string[];
  issuesResolved: string[];
  nextSteps: string[];
  source: MemorySource;
}

export interface TaskLog {
  id: string;
  title: string;
  date: string;
  tool: string;
  status: string;
  objective: string;
  context: string[];
  plan: string[];
  filesRead: string[];
  filesChanged: string[];
  commandsRun: string[];
  decisions: string[];
  problems: string[];
  result: string;
  nextSteps: string[];
}

export interface CodexHandoff {
  taskTitle: string;
  objective: string;
  currentState: string;
  relevantFiles: string[];
  constraints: string[];
  codingStandards: string;
  safetyRules: string[];
  expectedOutput: string[];
  memoryFilesToRead: string[];
  postExecutionInstructions: string[];
}

export interface MemoryBundle {
  agents: string;
  projectMemory: string;
  currentState: string;
  techStack: string;
  codingStandards: string;
  openIssues: string;
  sharedDialogMemory: string;
  chatTasks: string;
  decisionsIndex: string;
  agentContext: string;
}
