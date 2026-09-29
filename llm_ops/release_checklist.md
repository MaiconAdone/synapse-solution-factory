# LLM Release Checklist

- Prompt registry entry updated.
- Eval cases updated.
- Guardrails reviewed.
- Observability fields available.
- Cost and latency budgets reviewed.
- Rollback path documented.
- Local pipeline green: `python scripts/synapse_ci.py pipeline` (evals gate, build, dev, staging).
- Prod promotion with a named approver: `python scripts/synapse_ci.py promote --env prod --approver <nome>`.

