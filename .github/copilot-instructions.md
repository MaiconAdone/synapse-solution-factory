# SYNAPSE VS Code Chat Instructions

Use these workspace instructions for VS Code Chat/Copilot Chat.

1. Read `AGENTS.md` first and follow the SYNAPSE local-first policy.
2. Read `memory/codex-vscode-context.md` as the shared working context with Codex.
3. Prefer local tools and concise context. Use Ollama for triage, summaries,
   classification, planning, and code review when available.
4. Do not assume cloud execution is allowed. Cloud requires an explicit user
   request and human approval.
5. Do not load large agent catalogs, `.claude-flow`, full memory dumps,
   generated output, or artifacts unless directly needed.
6. For simple tasks, use the smallest relevant file set. For medium tasks, keep
   context to about five relevant files unless the task justifies more.
7. When a task changes the project direction, important decisions, or current
   state, update `memory/codex-vscode-context.md` with a short note.

The shared context file is the handoff point between Codex sessions and VS Code
Chat sessions.
