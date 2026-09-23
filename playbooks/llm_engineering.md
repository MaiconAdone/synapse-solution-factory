# LLM Engineering Playbook

## Runtime Practices

- Use structured outputs for application contracts.
- Log model, prompt version, tool calls, latency, token usage, and outcome.
- Prefer smaller models when evals prove quality is sufficient.
- Add guardrails at input, retrieval, tool, and output boundaries.
- Keep provider-specific code behind adapters.
- Scale retrieval by `config/rag_scalability_policy.json` (hybrid search, versioned indexes, ACL before ranking).
- Adapt models in order prompt -> RAG -> fine-tuning (`config/fine_tuning_policy.json`).
- Wrap every agent in a harness with loop budgets and repeated-trial evals (`config/harness_engineering_policy.json`).

## Release Gates

- Prompt registry entry exists.
- Evals pass minimum quality score.
- Safety checks pass.
- Cost and latency are within budget.
- Rollback configuration is documented.

