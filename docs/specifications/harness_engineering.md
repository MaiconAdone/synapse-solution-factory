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
| feedback_loop | config/agent_improvement_loop.json | all |
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
`summarize_trials` and `HarnessAuditor`.

## Mechanical Enforcement

Rules that matter are enforced by tests, not by prose: structural contract
tests guard generated-project boundaries, every referenced repository path must
exist or be declared as generated/runtime, and validation scripts fail loudly.

## Roles

`testing-qa` and `observability-ops` own the eval harness and traces;
`security-compliance` and `policy-guardrails-engineer` own tool boundaries and
the autonomy matrix.
