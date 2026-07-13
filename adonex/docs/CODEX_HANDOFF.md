# Codex Handoff

Use `AdoneX: Generate Codex Handoff` or:

```text
@adonex /handoff-codex implementar uma mudanca transversal
```

AdoneX reads shared memory, current state, coding standards, open issues, and
task-ranked workspace files. It optionally creates a snapshot and writes
`.adonex/handoff/CODEX_PROMPT.md`.

Codex should read that prompt, preserve memory history, avoid sensitive files,
perform the task, validate it, and write `.adonex/handoff/CODEX_RESULT.md`.

Afterward run `AdoneX: Import Codex Result`. AdoneX reads the result and a
bounded, secret-filtered Git diff, asks for approval, then updates current state,
development history, decisions, issues, changelog, and a timestamped task log.
