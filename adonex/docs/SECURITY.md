# Security

- OpenAI keys are stored in VS Code SecretStorage.
- `.env`, private keys, credentials paths, and `.adonex` are excluded by default.
- `.env` and every `.env.*` variant, including examples, are excluded.
- Common secret patterns are redacted before context leaves the workspace.
- Local / Ollama mode has no OpenAI code path.
- Writes and commands require explicit approval outside detected Synapse workspaces.
- Synapse autonomous mode may write and run allowed commands without prompts, but
  still enforces backups, secret filtering, safe paths, command policy, and a
  bounded correction loop.
- Source writes and commands outside Synapse require approval at runtime, even if a
  legacy setting is disabled.
- Workspace-relative patch paths are resolved and blocked if they escape root.
- Destructive commands and credential mutations are blocked.
- Patch logs contain diffs, never provider credentials.
- Native `@adonex` Chat handles read-only requests locally through Ollama.
- Chat commands with side effects only open the governed sidebar workflow.

The deprecated `adonex.openai.apiKey` setting exists only for compatibility.
SecretStorage is the recommended configuration.
