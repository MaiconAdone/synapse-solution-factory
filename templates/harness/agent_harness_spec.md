# Agent Harness Spec

One card per agent (or fleet) before it runs with real tools.
Policy: `config/harness_engineering_policy.json`. Spec: `docs/specifications/harness_engineering.md`.

## Identity

- Agent id and fleet:
- Objective and success criteria:
- Model tier (economy / standard / strong) and why:

## Context

- Instruction sources (AGENTS.md, CLAUDE.md, prompt id + version):
- Retrieval / memory scopes allowed:
- Context budget (tokens) and filtering rule:

## Tools

| Tool | Allowed | Needs approval | Forbidden | Idempotency key | Side effect |
|------|---------|----------------|-----------|-----------------|-------------|
|      |         |                |           |                 |             |

## Control Loop

- max_steps / max_tool_calls / max_retries_per_tool:
- Loop detection (same call repeated N times):
- Wall-clock timeout:
- Stop and escalate conditions (low confidence, blocked, high risk):

## Verification

- Deterministic tests:
- Eval cases (path) and graders:
- Trials per case (k) and pass^k gate:

## Observability

- Trace fields (model, prompt version, tools, tokens, latency, outcome):
- Alerts:

## Feedback

- Where failures become eval cases:
- Who approves promotions to memory:
