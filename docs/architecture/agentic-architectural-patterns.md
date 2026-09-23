# Agentic Architectural Patterns

This document defines SYNAPSE's reusable patterns for enterprise multi-agent
systems. It translates broad agentic architecture ideas into governed project
contracts. It does not copy book content.

## Operating Policy

- Start with one assistant; specialists are roles in `config/roles.json`, not
  separately activated agents.
- Route all model calls through the LLM Gateway / Model Router.
- Use Codex/OpenAI or Claude Code/Anthropic directly; destructive or external
  actions follow the autonomy matrix in `config/harness_engineering_policy.json`.
- Share short local peer summaries before sending large context to a model.
- Treat callbacks as audit events, not as extra model calls.
- Keep high-risk actions simulation-first until a human approves execution.

## Patterns

### Orchestrator Specialist

Use a lead orchestrator to choose the smallest useful set of specialists. In
SYNAPSE there is no standalone runtime/router/governance service; the
assistant executes the workflow directly and is responsible for reading
`config/runtime_manifest.json`, `config/cost_optimization_policy.json`, and
the `governance` section of `config/harness_engineering_policy.json`.

### Critic Reviewer Gate

Route risky changes through reviewer roles and quality gates. Security,
compliance, production release and failed validation signals should trigger a
reviewer or human approval gate.

### Agent To Agent Message Contract

Codex, Claude and humans should exchange short structured local
messages through `synapse-peers`. Messages should include objective, source,
target, context summary, evidence, requested decision, risk level, token budget
and status.

### Tool Gateway

Tools remain behind explicit permissions, scopes and audit records. Tool calls
that can affect external systems require approval and should include rollback or
compensation notes.

### Model Router

Agents do not call LLMs directly. The gateway routes by task type, sensitivity,
cost, latency, quality and fallback policy.

### Shared Memory Retrieval

Retrieve concise prior context before asking a model to reason from scratch.
Memory improves future work through approved feedback and evals, not automatic
weight changes.

### Lifecycle Callbacks

Stable callbacks make plans auditable without adding model calls:

- `on_plan_created`
- `on_agent_selected`
- `on_model_routed`
- `on_tool_called`
- `on_memory_read`
- `on_validation_failed`
- `on_human_approval_required`
- `on_execution_completed`

## Production Checks

- Every workflow step has an owner role, a conflict resolver and a handoff contract.
- Every agent blueprint defines role, authority, tools, model profile, memory
  scope, escalation rule and quality gate.
- Every high-risk path records a human approval decision.
- Every execution emits audit records with selected agents, model route, cost
  profile, quality result and decision fingerprint.
