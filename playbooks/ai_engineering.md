# AI Engineering Playbook

## Design Rules

- Start with the user task, failure modes, and measurable acceptance criteria.
- Define evals before optimizing prompts, retrieval, model choice, or agents.
- Treat model behavior as a product surface with quality, cost, latency, and safety budgets.
- Keep data, prompts, tools, evals, and model configuration versioned.
- Prefer deterministic contracts, schemas, and workflow state around probabilistic model calls.
- Use feedback loops deliberately: eval failures, user feedback, drift, incidents, and human review become backlog or retraining inputs only after review.
- Choose simple algorithms, data structures, and routing rules before escalating to broader multiagent reasoning.
- Keep local-first operation as the default; cloud and external side effects require explicit user request and human approval.

## Delivery Checklist

- Problem statement exists.
- Target users and critical workflows are named.
- Offline eval dataset exists or a synthetic seed set is defined.
- Online metrics are identified.
- Cost, latency, confidence, uncertainty, and safety signals are observable.
- Tool permissions, idempotency expectations, and rollback or compensation path are named for external actions.
- Human review path exists for high-risk outputs.
- Rollback path exists.

## Book-Inspired Gates

- Winston gate: the problem representation, search space, plan, and explanation path are clear enough for review.
- Wiener gate: each adaptive loop has a signal, comparator, intervention rule, and audit record.
- Minsky gate: specialist roles are explicit, bounded, and synthesized by an orchestrator instead of becoming unmanaged parallel work.
- CLRS gate: workflow, retrieval, memory, and routing choices have clear complexity and correctness tradeoffs.
- Modern AI engineering gate: quality, cost, latency, safety, and feedback metrics exist before scaling models or agents.
