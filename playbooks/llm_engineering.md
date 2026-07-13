# LLM Engineering Playbook

## Runtime Practices

- Use structured outputs for application contracts.
- Log model, prompt version, tool calls, latency, token usage, and outcome.
- Prefer smaller models when evals prove quality is sufficient.
- Add guardrails at input, retrieval, tool, and output boundaries.
- Keep provider-specific code behind adapters.

## Release Gates

- Prompt registry entry exists.
- Evals pass minimum quality score.
- Safety checks pass.
- Cost and latency are within budget.
- Rollback configuration is documented.

