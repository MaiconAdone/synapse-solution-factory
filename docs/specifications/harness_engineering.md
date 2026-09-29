# Harness Engineering Specification

Applies to every universe. Source of truth:
`config/harness_engineering_policy.json`.

## What The Harness Is

The model is one component. The harness is everything engineered around it so
an agent behaves reliably: the map of instructions and context, the tools and
their permissions, the control loop with budgets and stop conditions, the
execution safety rules, verification by tests and evals, traces, and the
feedback loop that turns failures into new cases. Synapse is itself a harness
for Claude Code and Codex, and every generated project inherits one.

Three layers:

- Coding-agent harness: how Claude Code and Codex operate a repository
  (`AGENTS.md`, `CLAUDE.md`, context policy, validation commands, shared memory).
- Agent runtime harness: how agents inside a solution run (tool gateway,
  budgets, approval gates, traces).
- Eval harness: how any capability is proven (versioned cases, graders,
  repeated trials, gates, CI).

## Components And Evidence

| Component | Evidence | Universes |
|-----------|----------|-----------|
| context_map | AGENTS.md, CLAUDE.md, config/context_policy.json | all |
| tool_boundary | config/harness_engineering_policy.json, guardrails/policy.yaml | all |
| control_loop | config/cost_optimization_policy.json, config/agent_blueprint_contract.json | all |
| verification | tests/, evals/quality_gates.yaml | all |
| agent_evals | evals/tool_workflow_cases.jsonl | IA, Chatbolt, Hybrid |
| agent_blueprints | config/solution_agents.json, config/workflows/synapse/agent-build.json | IA, Chatbolt, Hybrid |
| observability | llm_ops/observability.yaml | IA, Chatbolt, Hybrid |
| feedback_loop | config/agent_improvement_loop.json, scripts/synapse_lib/improvement_loop.py | all |
| runtime_guard | scripts/synapse_lib/agent_harness.py, config/tool_registry.json | IA, Chatbolt, Hybrid |
| mcp_gateway | scripts/synapse_lib/mcp_gateway.py, templates/mcp/server.py | IA, Chatbolt, Hybrid |
| llm_gateway | scripts/synapse_lib/llm_gateway.py, config/model_providers.json, config/cost_optimization_policy.json | IA, Chatbolt, Hybrid |
| output_guardrails | scripts/synapse_lib/guardrails_runtime.py, guardrails/policy.yaml | IA, Chatbolt, Hybrid |
| knowledge_verification | config/rag_scalability_policy.json, evals/retrieval_cases.jsonl, config/knowledge_graph_policy.json, evals/graph_cases.jsonl | IA, Chatbolt, Hybrid |
| cicd | config/cicd_policy.json, scripts/synapse_lib/cicd.py, scripts/synapse_ci.py | all |
| drift_monitoring | scripts/synapse_lib/drift.py, ml_systems/monitoring_plan.yaml | ML, Hybrid |
| safe_execution | config/business_transformation.json | all |

Audit a project:

```powershell
python .\scripts\audit_harness.py
```

## Control Loop Limits

Defaults: 25 steps, 40 tool calls, 2 retries per tool with exponential backoff,
loop detection after the same tool+arguments repeats 3 times, 600s wall clock.
Side-effecting tools need idempotency keys, simulation first, and human approval
when irreversible.

## Runtime Guard

`AgentRunGuard` (`scripts/synapse_lib/agent_harness.py`) is the executable
agent runtime harness. Build it with `AgentRunGuard.from_policy(agent_id)`: the
allowed tools come from the agent blueprint in `config/solution_agents.json`,
the tool rules from `config/tool_registry.json` and the limits from this policy.
Every call returns one decision:

| Decision | When |
|----------|------|
| allowed | tool registered, in the blueprint, arguments complete, gates satisfied |
| needs_simulation | irreversible side effect not simulated yet |
| needs_approval | approval-required tool without human approval |
| refused | blocked input, unknown tool, least privilege, missing args, side effect without idempotency key |
| stopped | loop detected, max steps/tool calls, retries exhausted or wall clock exceeded (stop and escalate) |

Each decision is appended to a trace with PII and secrets redacted
(`llm_ops/observability.yaml`); `export_trace` writes JSONL. Tools with status
`example` in the registry only exercise the eval cases and must be replaced by
the inventory the user confirms.

## LLM Gateway, Output Guardrails And Improvement Loop

`LlmGateway` (`scripts/synapse_lib/llm_gateway.py`) is the only model path of
solution agents: tier routing by task type, token budget per request profile,
stable-first prompt layout with `cache_control`, secrets/PII input blocking,
output guardrails (`scripts/synapse_lib/guardrails_runtime.py`) and a trace with
input, output, cache-creation and cache-read tokens, latency and estimated cost.
Each result can feed `ImprovementLoop` (`scripts/synapse_lib/improvement_loop.py`):
failures become quarantined review cases; good examples are promoted for
retrieval only by a named human, never for automatic training.

## MCP Tool Gateway

`templates/mcp/server.py` exposes solution tools over MCP through
`ToolGateway` (`scripts/synapse_lib/mcp_gateway.py`), which wraps the runtime
guard and adds what only an execution boundary can guarantee: simulation runs
the handler in dry-run mode and only that exact call is unlocked; human
approval is out-of-band (`ToolGateway.approve` is never an MCP tool; agents only
call `request_human_approval`); replaying an idempotency key returns the stored
result without executing again; tools without a handler are refused. Traces go
to `artifacts/traces/mcp_gateway.jsonl`.

## Eval Harness

- Case fields: `id`, `input`, `expected`, `grader`, `tags`.
- Grader order: deterministic, schema, model-graded with a written rubric, human.
  Use the cheapest grader that can decide.
- Agent cases run 3 trials. Report pass@k (at least one success: capability)
  and pass^k (all succeed: reliability). Release requires pass^k of at least 0.8.
- Reproducibility: record model id, prompt version, dataset hash; temperature 0
  when supported.
- Flaky cases are quarantined with an owner and a date; failing cases are never
  deleted to turn the suite green.
- Deterministic suites run on every change (CI); model-backed suites run before release.

`scripts/synapse_lib/harness_service.py` implements `pass_at_k`, `pass_hat_k`,
`summarize_trials` and `HarnessAuditor`. `python scripts/run_evals.py agent`
runs `evals/tool_workflow_cases.jsonl` through the runtime guard for
`trials_per_agent_case` trials and gates pass^k (`agent_harness` in
`evals/quality_gates.yaml`). The reference runner proposes the labeled tool to
prove the guard; `--runner module:function` plugs the real agent (a function
that receives a case and the registry and returns the proposed tool calls).

## Mechanical Enforcement

Rules that matter are enforced by tests, not by prose: structural contract
tests guard generated-project boundaries, every referenced repository path must
exist or be declared as generated/runtime, and validation scripts fail loudly.

## Roles

`testing-qa` and `observability-ops` own the eval harness and traces;
`security-compliance` and `policy-guardrails-engineer` own tool boundaries and
the autonomy matrix.
