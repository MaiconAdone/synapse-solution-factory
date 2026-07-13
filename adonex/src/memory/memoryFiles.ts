export const MEMORY_PATHS = {
  agents: "AGENTS.md",
  architecture: "docs/ARCHITECTURE.md",
  decisions: "docs/DECISIONS.md",
  developmentLog: "docs/DEVELOPMENT_LOG.md",
  roadmap: "docs/ROADMAP.md",
  projectMemory: ".adonex/memory/PROJECT_MEMORY.md",
  currentState: ".adonex/memory/CURRENT_STATE.md",
  techStack: ".adonex/memory/TECH_STACK.md",
  codingStandards: ".adonex/memory/CODING_STANDARDS.md",
  openIssues: ".adonex/memory/OPEN_ISSUES.md",
  sharedDialogMemory: ".adonex/memory/SHARED_DIALOG_MEMORY.md",
  chatTasks: ".adonex/memory/CHAT_TASKS.md",
  decisionsIndex: ".adonex/memory/DECISIONS_INDEX.md",
  agentContext: ".adonex/memory/AGENT_CONTEXT.md",
  codexPrompt: ".adonex/handoff/CODEX_PROMPT.md",
  codexResult: ".adonex/handoff/CODEX_RESULT.md",
  adonexContinuation: ".adonex/handoff/ADONEX_CONTINUATION.md",
  lastHandoff: ".adonex/handoff/LAST_HANDOFF.md",
  agentChangelog: "CHANGELOG_AGENT.md"
} as const;

export const MEMORY_DIRECTORIES = [
  ".adonex/memory",
  ".adonex/tasks",
  ".adonex/handoff",
  ".adonex/snapshots",
  "docs"
];

export const CORE_MEMORY_PATHS = [
  MEMORY_PATHS.agents,
  MEMORY_PATHS.agentContext,
  MEMORY_PATHS.currentState,
  MEMORY_PATHS.codingStandards
];

export const MEMORY_TEMPLATES: Record<string, string> = {
  [MEMORY_PATHS.agents]: `# Project Agent Instructions

## Project Overview
Describe the product, users, and business outcome.

## Install, Build, And Test
- Install: document the project install command.
- Build: document the build command.
- Test: document the smallest reliable validation command.

## Coding Standards
Read \`.adonex/memory/CODING_STANDARDS.md\` before changing code.

## Security Rules
- Never read, log, or send \`.env\`, credentials, tokens, passwords, or private keys.
- Keep writes and terminal commands behind human approval.
- Redact suspected secrets as \`[REDACTED]\`.

## Required Memory
Always read:
- \`.adonex/memory/AGENT_CONTEXT.md\`
- \`.adonex/memory/CURRENT_STATE.md\`
- \`.adonex/memory/CODING_STANDARDS.md\`
- \`.adonex/memory/OPEN_ISSUES.md\`
- \`.adonex/memory/SHARED_DIALOG_MEMORY.md\`
- \`.adonex/memory/CHAT_TASKS.md\`

Never send sensitive files, binary files, dependency folders, build output, or files outside the task scope to an LLM.

## AdoneX To Codex To AdoneX
Use AdoneX/Ollama for triage and bounded planning. Generate a Codex handoff for complex work. After Codex finishes, import its result and Git diff through AdoneX.

## Memory Update Policy
After each task, append a task log and update current state, development history, decisions, and issues without deleting prior history.

## Shared Dialog Memory
VS Code Chat, Codex, Claude Code and AdoneX share task context through
\`.adonex/memory/SHARED_DIALOG_MEMORY.md\`, \`.adonex/memory/CHAT_TASKS.md\`,
and the local \`synapse-peers\` MCP mailbox. Before starting a new task from
chat, read the recent shared dialog entries and avoid asking the user to repeat
context already recorded there.

## Synapse Solution Factory Channels
Authorized channels for user-requested corporate solution content are VS Code
Chat, AdoneX, Claude Code and Codex. Collect or confirm goals, constraints,
files, decisions, approvals and missing briefing fields through these chats
before using tasks, scripts, browser UI or tools. All four channels use the
same Synapse project artifacts: shared memory, Solution Factory policy,
technology catalog, BusinessSolutionAnalyzer, governance docs, tests and evals.
`,
  [MEMORY_PATHS.architecture]: "# Architecture\n\n## Current Architecture\n\n## Boundaries\n\n## Data Flow\n",
  [MEMORY_PATHS.decisions]: "# Technical Decisions\n\nAppend dated decisions below.\n",
  [MEMORY_PATHS.developmentLog]: "# Development Log\n\nAppend task outcomes below.\n",
  [MEMORY_PATHS.roadmap]: "# Roadmap\n\n## Now\n\n## Next\n\n## Later\n",
  [MEMORY_PATHS.projectMemory]: `# Project Memory

## Project Goal

## Business Context

## General Architecture

## Main Stack

## Important Decisions

## Technical Standards

## Integrations

## Constraints

## Next Milestones
`,
  [MEMORY_PATHS.currentState]: `# Current State

## Current Project State

## Last Completed Task

## Ready Features

## Features In Development

## Open Problems

## Next Steps
`,
  [MEMORY_PATHS.techStack]: `# Tech Stack

## Languages

## Frameworks

## Database

## AI And LLM

## Agents

## Infrastructure

## Tests

## Local Tools
`,
  [MEMORY_PATHS.codingStandards]: `# Coding Standards

## Code Style

## Modular Architecture

## Naming

## Error Handling

## Structured Logs

## Tests

## Documentation

## Security
`,
  [MEMORY_PATHS.openIssues]: `# Open Issues

## Open Bugs

## Technical Risks

## Technical Debt

## Blockers

## Pending Questions

## Resolved
`,
  [MEMORY_PATHS.sharedDialogMemory]: `# Shared Dialog Memory

This file is the persistent local memory shared by VS Code Chat, Codex,
Claude Code and AdoneX.

## Rules

- Store only short task summaries, decisions, missing questions and outcomes.
- Do not store secrets, credentials, private keys, full datasets or large diffs.
- Prefer references to files and task ids instead of copying large context.
- Use \`synapse-peers\` for short live messages between active sessions.

## Recent Dialog Context
`,
  [MEMORY_PATHS.chatTasks]: `# Chat Tasks

Tasks requested by the user through VS Code chat, Codex, Claude Code or AdoneX
are appended here so every assistant can continue with the same context.

| Date | Source | Status | Objective | Notes |
| --- | --- | --- | --- | --- |
`,
  [MEMORY_PATHS.decisionsIndex]: `# Decisions Index

| Date | Decision | Reason | Impact |
| --- | --- | --- | --- |
`,
  [MEMORY_PATHS.agentContext]: `# Agent Context

## Quick Instructions
Read the core memory before planning. Work with focused context and preserve history.

## Project Summary

## How To Work
Plan before implementation, select only relevant files, validate changes, and record outcomes.

## Recording Changes
Append task history and decisions. Update current state without erasing historical logs.

## Tool Routing
- Use Codex for complex multi-file or cross-system implementation.
- Use AdoneX for governed workspace workflows.
- Use Ollama for local triage, summaries, classification, and initial review.
- Share chat task context through \`.adonex/memory/SHARED_DIALOG_MEMORY.md\`,
  \`.adonex/memory/CHAT_TASKS.md\`, and the \`synapse-peers\` MCP mailbox.
- Before asking for repeated context, check shared dialog memory and pending
  peer messages.
- For Synapse project creation or implementation, follow config/llm_solution_factory_policy.json.
- Authorized channels for user-requested corporate solution content are VS Code Chat, AdoneX, Claude Code and Codex.
- Collect or confirm goals, constraints, files, decisions, approvals and missing briefing fields through these chats before using tasks, scripts, browser UI or tools.
- All four channels use the same Synapse project artifacts: shared memory, Solution Factory policy, technology catalog, BusinessSolutionAnalyzer, governance docs, tests and evals.
- Consult BusinessSolutionAnalyzer or config/business_solution_analysis.json before architecture decisions.
- If objective, business problem, universe, success metric, data/sources, or risk is missing, ask the user before implementation.
- Treat VS Code tasks as optional shortcuts; the chat/dialog flow is primary.
`,
  [MEMORY_PATHS.agentChangelog]: "# Agent Changelog\n\nAppend agent-generated changes below.\n"
};
