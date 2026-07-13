# Prompt Engineering Playbook

## Prompt Contract

Every production prompt should define:

- role and objective
- allowed inputs
- output schema
- examples or counterexamples when useful
- tool-use policy
- safety constraints
- evaluation cases

## Review Checklist

- The prompt does not rely on hidden assumptions.
- The output is parseable or otherwise easy to validate.
- The prompt separates task instructions from user data.
- The prompt is resilient to prompt injection.
- Regression examples are stored in `evals/prompt_cases.jsonl`.

