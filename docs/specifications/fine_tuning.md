# Fine-Tuning and Model Adaptation Specification

Applies to IA, Chatbolt and Hybrid projects when an LLM, embedding model or
reranker needs adaptation. Classical ML training in the ML universe follows
`docs/specifications/ml_foundations.md` instead. Source of truth:
`config/fine_tuning_policy.json`.

## Adaptation Ladder

Climb one step only after the previous one is measured and falls short:

1. Prompt engineering: output contracts, instructions, few-shot examples.
2. RAG: missing, changing, cited or permission-specific knowledge.
3. Fine-tuning: behavior, format, narrow-task accuracy, tool-call reliability,
   cost/latency through a smaller model, or domain embeddings.
4. Continued pretraining: new language or vocabulary at scale; requires
   explicit architecture review.

Rule of thumb: knowledge gaps go to RAG, behavior gaps go to fine-tuning.
Fine-tuning does not keep facts fresh and cannot enforce document permissions.

## Block Conditions

Fine-tuning is blocked when any of these holds: no eval set, no measured
prompt + RAG baseline, dataset below the minimum, unresolved PII or secrets,
restricted data would leave the approved environment, or no rollback to the
base model.

## Techniques

- SFT on curated input/output pairs.
- LoRA adapters (default for open-weight models); QLoRA when GPU memory is the limit.
- Preference tuning (DPO-style chosen/rejected pairs) when ranking or tone is the gap.
- Distillation: a smaller model learns from reviewed outputs of a larger one.
- Embedding fine-tuning on (query, relevant chunk) pairs to lift retrieval recall.
- Reranker fine-tuning on labeled query/chunk relevance.

Managed fine-tuning availability, base models, retention and pricing are
provider-dependent: confirm them at the time of use.

## Dataset Contract

- JSONL chat format: `{"messages": [...], "human_score": 0.0-1.0}`.
- Sources: `data/learning/training_examples.jsonl`, reviewed eval failures,
  human-reviewed production transcripts.
- Minimum 50 accepted examples for a pilot and 500 for production (Synapse defaults).
- Human score at least 0.8, matching `config/agent_improvement_loop.json`.
- Exact and normalized deduplication; deterministic hash split (15% validation)
  on the prompt side so identical prompts never leak across splits.
- PII and secret scan; offending rows are excluded and reported.
- License/consent and a data card are recorded before training.

Prepare a dataset without training anything:

```powershell
python .\scripts\prepare_fine_tuning_dataset.py --input data\learning\training_examples.jsonl --tier pilot
```

Outputs `artifacts/fine_tuning/train.jsonl`, `validation.jsonl` and
`readiness_report.json` with blockers and warnings.

## Release Gates

- Beat the prompt + RAG baseline by at least 5% relative on the same eval set.
- No regression on safety, prompt-injection and retrieval-faithfulness evals.
- Cost and latency within budget.
- Model card and `templates/fine_tuning/model_adaptation_card.md` completed.
- Human approval, shadow or canary rollout, and a tested rollback to the base model.
- `automatic_weight_updates` stays `false`: continual learning improves memory
  and evals; weights change only through this gated process.

## Agents And Fleet

`ml_fleet` for training discipline (`model-evaluation-specialist`,
`experiment-tracking-specialist`) with `llm-engineering`; `security_fleet`
(`privacy-lgpd-reviewer`) reviews the dataset; `cost_optimization_fleet`
validates the cost/latency case.
