# Agent Harness Spec

One card per agent before it runs with real tools.
Policy: `config/harness_engineering_policy.json`. Spec: `docs/specifications/harness_engineering.md`.

## Identity

- Agent id and owner role (`config/roles.json`):
- Objective and success criteria:
- Model tier (economy / balanced / strong) and why:

## Context

- Instruction sources (AGENTS.md, CLAUDE.md, prompt id + version):
- Retrieval / memory scopes allowed:
- Context budget (tokens) and filtering rule:

## Tools

Every tool must be registered in the tool registry named by
`reference_implementation.tool_registry` in `config/harness_engineering_policy.json`
(IA, Chatbolt and Hybrid); the runtime guard (`scripts/synapse_lib/agent_harness.py`)
refuses anything else.

| Tool | Allowed | Needs approval | Simulation first | Idempotency key | Side effect |
|------|---------|----------------|------------------|-----------------|-------------|
|      |         |                |                  |                 |             |

## Control Loop

- max_steps / max_tool_calls / max_retries_per_tool:
- Loop detection (same call repeated N times):
- Wall-clock timeout:
- Stop and escalate conditions (low confidence, blocked, high risk):

## Verification

- Deterministic tests:
- Eval cases (path) and graders:
- Trials per case (k) and pass^k gate (`python scripts/run_evals.py agent --runner <module:function>`):

## Observability

- Trace fields (model, prompt version, tools, tokens, latency, outcome):
- Alerts:

## Feedback

- Where failures become eval cases:
- Who approves promotions to memory:
