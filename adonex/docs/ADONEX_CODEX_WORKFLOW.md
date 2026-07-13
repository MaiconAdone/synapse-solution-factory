# AdoneX And Codex Workflow

1. Initialize memory with **AdoneX: Initialize Shared Memory**.
2. Plan locally with `@adonex /planejar ...`.
3. AdoneX classifies the task as local, OpenAI-sized, or Codex-recommended.
4. For complex work, generate `.adonex/handoff/CODEX_PROMPT.md`.
5. Execute the approved task with Codex.
6. Record the implementation in `.adonex/handoff/CODEX_RESULT.md`.
7. Run `@adonex /importar-codex`.
8. Run `@adonex /sync-memoria` when workspace state needs reconciliation.

AdoneX remains the governed memory coordinator. Codex remains the recommended
executor for complex multi-file, architectural, security, full-stack, MCP,
Ruflo, and complete AI/ML pipeline work.
