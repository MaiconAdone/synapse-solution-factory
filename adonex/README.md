# AdoneX

AdoneX is an independent AI engineering extension for VS Code. It combines
OpenAI, local Ollama models, bounded workspace context, autonomous Synapse execution,
patch previews, test commands, cost controls, specialist prompts, and a prepared
MCP tool registry.

It is not a Codex clone. AdoneX uses the user's own provider configuration and
can operate without cloud calls in Local / Ollama mode.

## MVP Capabilities

- Native VS Code Chat participant available as `@adonex`
- Repository-backed shared project memory for AdoneX and Codex
- Chat commands for plan, implementation, review, tests, agents, MCP, and roadmap
- Sidebar chat with Plan, Implement, Review, Test, and Document actions
- Economic, Balanced, Strong, Local / Ollama, and Synapse modes
- OpenAI Responses API using VS Code SecretStorage
- Deterministic Ollama requests with temperature `0` and seed `42`
- Deterministic prompt compiler before model execution
- Ruflo 60-agent council for Synapse tasks with one consolidated local Ollama call by default
- Workspace stack detection and task-based file selection
- Secret redaction and sensitive-file exclusion
- Plan and cost estimate before execution
- Task-aware file ranking with recorded selection reasons
- Unified diff generation and visual diff preview in the sidebar
- Automatic backups, path protection, and local patch logs
- Dangerous-command blocking and autonomous terminal execution only in detected Synapse workspaces
- Captured test output, failure diagnosis, and approved correction patches
- Per-task records under `.adonex/tasks`
- Technical completion summary and commit suggestion
- Synapse workspace detection and engineering profile
- Eight internal specialist prompts
- Initial MCP registry and tool contracts
- Synapse Peers setup for local Codex/Claude coordination with short summaries

## Install And Compile

```powershell
cd adonex
npm install
npm run compile
npm test
npm run test:extension
```

Use `npm run check` for the complete validation: bundled compilation, unit
tests, and an isolated VS Code Extension Host test. The host test activates the
real extension, executes shared-memory commands, generates a Codex handoff, and
checks the `@adonex` Chat contribution.

Production packaging uses esbuild. The OpenAI SDK and extension modules are
bundled into `dist/extension.js`; `vscode` remains an external host API. The
VSIX excludes source TypeScript, tests, development tools, and `node_modules`.

## Run In VS Code

1. Open the `adonex` folder as the VS Code workspace.
2. Press `F5`.
3. In the Extension Development Host, open Chat and type `@adonex`.
4. Use `/plan`, `/review`, or `/roadmap` for local read-only work.
5. Use `/implement`, `/test`, `/agent`, or `/mcp` to prepare a governed task.
6. Open the AdoneX activity-bar view to approve diffs, writes, and commands.
7. Run `AdoneX: Configure API Key` only when cloud modes are explicitly needed.
8. Keep Ollama running for native Chat, Economic, Local / Ollama, and Synapse modes.

## Native VS Code Chat

The `@adonex` participant is local-first and reuses the same workspace selection,
secret redaction, Synapse detection, prompts, and cost estimation as the sidebar.
Read-only requests call Ollama directly. Requests with side effects return a
plan and an **Open governed task** button; they never write files or run terminal
commands from the Chat handler.

VS Code normally inserts `@adonex` automatically after selecting the
participant. AdoneX also tolerates duplicated mentions such as
`@adonex @adonex /status`. Memory commands are resolved before any Ollama call.
Local requests use bounded context compatible with the configured Ollama window.
The default local timeout is 600 seconds for CPU-only machines, and the model
stays loaded for 10 minutes between requests. Both values are configurable under
`adonex.ollama`.

Before calling Ollama or OpenAI, AdoneX compiles the user's request into an
optimized prompt with role, objective, operational context, response contract,
safety rules, and cost policy. This prompt engineering layer is deterministic,
does not make an extra model call, and can be disabled with
`adonex.promptEngineering.enabled`.

The default AdoneX profile for Synapse is maximum local quality: a 4096-token
Ollama window, the Ruflo 60-agent council, governance, shared memory, and larger
diff/memory imports. Codex handoffs remain economical and list up to 8 files so
Codex quota is not spent on catalogs, generated outputs, or full project history.

Run `AdoneX: Test Ollama Connection` from the Command Palette to verify the
connection from the VS Code Extension Host itself.

Examples:

```text
@adonex /review revise o pipeline RAG
@adonex /plan planeje observabilidade para os agentes
@adonex /implement adicione health check ao backend
@adonex /agent crie um agente de avaliacao de respostas
@adonex /mcp crie uma ferramenta MCP somente leitura para custos
```

## Shared Project Memory

The repository, not Chat history, is the source of truth. Start with:

1. Run `AdoneX: Initialize Shared Memory`.
2. Plan with `@adonex /planejar ...`.
3. For complex work, run `@adonex /handoff-codex ...`.
4. Execute Codex using `.adonex/handoff/CODEX_PROMPT.md`.
5. Record the result in `.adonex/handoff/CODEX_RESULT.md`.
6. Run `@adonex /importar-codex`.
7. Reconcile state with `@adonex /sync-memoria`.

Useful memory commands include `/memoria`, `/status`, `/snapshot`,
`/registrar-tarefa`, `/decisao`, `/pendencia`, and `/resolver-pendencia`.

The task router keeps summaries and initial analysis on Ollama, reserves cloud
AdoneX for bounded medium work, and recommends Codex for complex multi-file,
security, full-stack, MCP/Ruflo, and complete AI/ML pipeline changes.

## Synapse Mode

Synapse Mode is a local-first senior AI architecture profile for Synapse projects.
It focuses on AI engineering, multi-agent systems, Ruflo, MCP, OpenAI, Ollama,
FastAPI, React, Postgres, MLflow, Jupyter, development automation, cost control,
and modular architecture.

AdoneX detects Synapse automatically from strong structural signals such as:

- `config/runtime_manifest.json`
- `scripts/start_ruflo_swarm.ps1`
- `.mcp.json`
- `CLAUDE.md` or `AGENTS.md`
- `agents`, `guardrails`, `llm_ops`, `rag_pipelines`, `ml_systems`, and `evals`

Automatic detection enriches the system prompt in every provider mode. Selecting
Synapse Mode explicitly also activates the profile and routes through Ollama to
keep routine architecture and implementation work local and inexpensive.

Detected Synapse workspaces run autonomously by default through
`adonex.synapse.autonomous`. AdoneX can plan, apply patches with backups, run
`npm run check`, capture failures, attempt one correction, and validate again.
Secrets, sensitive paths, workspace escapes, and dangerous commands remain
blocked. Non-Synapse workspaces retain approval prompts.

For Synapse tasks, AdoneX loads the Ruflo council as 60 active specialist roles:
15 core agents plus 45 specialists from `agents/definitions/enterprise_agents.yaml`.
The council is deterministic and local. It ranks the roles for the task,
compresses their review into the prompt, and asks Ollama for one consolidated
answer by default. This keeps cloud cost at zero and avoids making 60 concurrent
local model calls on CPU/RAM-constrained machines.

Dedicated commands:

- `AdoneX Synapse Analyze Architecture`
- `AdoneX Synapse Create Agent`
- `AdoneX Synapse Create MCP Tool`
- `AdoneX Synapse Review Pipeline`
- `AdoneX Synapse Generate Roadmap`

- `AdoneX Synapse: Configure Peer Messaging`
- `AdoneX Synapse: Open Peer Messaging Docs`

## Synapse Peers

AdoneX can configure the shared `synapse-peers` MCP server in `.mcp.json` so
Codex, Claude, Ruflo, and AdoneX workflows can exchange short local summaries
instead of repeating full workspace context.

Run `AdoneX Synapse: Configure Peer Messaging` from the Command Palette. The
command preserves existing MCP servers and adds `synapse-peers` with
`autoStart=false`, a local SQLite database, and conservative message limits.

The default policy is designed for token savings:

- publish a short `set_summary` before asking another peer for details;
- use `list_peers` scoped to the repository by default;
- keep `send_message` short and specific;
- never send secrets, full files, long diffs, or generated artifacts;
- do not use cloud auto-summary.

## API Key

Use `AdoneX: Configure API Key`. The value is stored in VS Code
`SecretStorage` and is never written to the project. `OPENAI_API_KEY` is an
optional fallback for local development.

## Safety Model

AdoneX plans before execution. Detected Synapse workspaces execute autonomously
by default; other workspaces require approval. Proposed patches remain visible
in the panel, backups are created before overwrites, and applied changes are
logged under `.adonex/logs`.

Additional design documents live in `docs/ARCHITECTURE.md`,
`docs/SECURITY.md`, `docs/COST_CONTROL.md`, `docs/synapse_INTEGRATION.md`, and
`docs/CHAT_INTEGRATION.md`. Shared memory is documented in
`docs/SHARED_MEMORY.md`, `docs/CODEX_HANDOFF.md`,
`docs/ADONEX_CODEX_WORKFLOW.md`, and `docs/synapse_MEMORY_POLICY.md`.
