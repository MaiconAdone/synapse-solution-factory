# Synapse Integration

AdoneX includes an explicit `Synapse Mode` and automatic structural detection.
The detector uses weighted evidence instead of generic keyword counting.

## Detection

Strong signals:

- `config/runtime_manifest.json`
- `scripts/start_ruflo_swarm.ps1`
- `.mcp.json`
- `CLAUDE.md` or `AGENTS.md`

Supporting signals:

- governed agent catalogs
- `guardrails`, `llm_ops`, and `rag_pipelines`
- `ml_systems`, notebooks, and evaluation suites
- Ruflo, agentic-mesh, Ollama/OpenAI, MLflow, and Jupyter references

A normal full-stack project is not considered Synapse merely because it has
`backend`, `frontend`, or an OpenAI dependency. Detection requires a confidence
threshold and at least one strong Synapse-specific signal.

## Runtime Behavior

When Synapse is detected, every AdoneX mode receives the senior Synapse
architecture system prompt. Explicit Synapse Mode additionally uses Ollama as its
provider, producing zero estimated cloud API cost.

AdoneX also activates a local Ruflo 60-agent council for Synapse tasks. This does
not mean 60 expensive model generations. The 15 core agents and 45 specialists
are loaded as deterministic parallel reviewer roles, ranked against the task,
and compressed into one council context before the Ollama call. By default,
`adonex.synapse.rufloCouncil.maxAgents` is `60` and
`adonex.synapse.rufloCouncil.llmConcurrency` is `1`, which is the recommended
profile for 16 GB RAM machines.

The profile focuses on:

- AI engineering and governed multi-agent systems
- Ruflo fleets, delegation, memory boundaries, and conflict resolution
- typed MCP tools with least privilege and hard safety boundaries
- OpenAI and Ollama routing with budget controls
- FastAPI, React, Postgres, MLflow, and Jupyter
- development automation, modular architecture, tests, security, and observability

Prompts inherit these Synapse principles:

- specification before implementation
- local-first model routing
- minimum useful Ruflo agent activation
- bounded context and token control
- governed multi-agent design
- Ruflo 60-agent council synthesis with a consolidated local Ollama response
- typed MCP contracts and safe tool execution
- autonomous writes and commands only after strong Synapse detection
- automatic backups and one bounded correction attempt
- production tests, observability, and security

## Commands

- `adonex.synapse.analyzeArchitecture`: read-only architecture review.
- `adonex.synapse.createAgent`: proposes a governed agent patch and tests.
- `adonex.synapse.createMcpTool`: proposes a typed MCP tool patch and tests.
- `adonex.synapse.reviewPipeline`: reviews RAG, ML, data, or release pipelines.
- `adonex.synapse.generateRoadmap`: creates a prioritized technical roadmap.

Creation commands use the normal AdoneX lifecycle: plan, task record, generated
diff, preview, automatic write with backup, captured tests, one correction
attempt, and final summary. The integration remains standalone and does not require the Synapse web
application to start.
