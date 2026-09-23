# SYNAPSE VS Code Chat Instructions

Use these workspace instructions for VS Code Chat/Copilot Chat.

1. Read `AGENTS.md` first and follow the SYNAPSE provider policy.
2. Read `memory/codex-vscode-context.md` as the shared working context with Codex.
3. Prefer concise context and the assistant-configured provider (OpenAI for
   Codex, Anthropic for Claude Code) for triage, summaries, classification,
   planning, and code review.
4. Destructive or external actions follow the autonomy matrix in `config/harness_engineering_policy.json`.
5. Do not load full memory dumps,
   generated output, or artifacts unless directly needed.
6. For simple tasks, use the smallest relevant file set. For medium tasks, keep
   context to about five relevant files unless the task justifies more.
7. When a task changes the project direction, important decisions, or current
   state, update `memory/codex-vscode-context.md` with a short note.

The shared context file is the handoff point between Codex sessions and VS Code
Chat sessions.
