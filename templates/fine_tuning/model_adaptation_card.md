# Model Adaptation Card

Fill this card before requesting approval for any fine-tuning run.
Policy: `config/fine_tuning_policy.json`. Spec: `docs/specifications/fine_tuning.md`.

## 1. Decision

- Business problem and task:
- Gap type (behavior/format, narrow accuracy, tool calls, cost/latency, retrieval):
- Why prompt engineering and RAG are not enough (link to measured results):
- Selected technique (SFT, LoRA, QLoRA, preference tuning, distillation, embedding, reranker):
- Base model and provider (availability, retention and pricing confirmed on):

## 2. Baseline

- Eval set path and hash:
- Prompt + RAG baseline metrics:
- Target metrics and minimum relative improvement (default 5%):

## 3. Dataset

- Source(s):
- `readiness_report.json` path and dataset hash:
- Accepted / train / validation counts:
- Excluded rows (schema, human score, PII/secrets, duplicates):
- License / consent / data classification:
- Data stays in approved environment: yes / no (if no, approver):

## 4. Results

- Adapted model metrics vs baseline:
- Safety, prompt-injection and faithfulness regressions: none / list:
- Cost per 1k requests and p95 latency vs budget:

## 5. Release

- Rollout (shadow / canary %):
- Rollback target (base model routing):
- Registry record (`artifacts/models`):
- Human approver and date:
