# Production LLMs Playbook

## Reliability

- Make every external model call timeout-aware and retry-safe.
- Use graceful degradation when MCP, vector DB, or model providers fail.
- Avoid silent fallbacks that hide quality regressions.
- Record enough traces to debug model behavior without storing secrets.

## Safety

- Check for PII and prompt injection.
- Restrict tools by role and workflow.
- Require citations for RAG answers.
- Block unsupported claims in high-risk domains.

