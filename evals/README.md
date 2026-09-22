# Evaluation Layer

Evaluation is required before changing model behavior, prompts, RAG pipelines,
or ML release criteria.

## Files

- `prompt_cases.jsonl`: prompt regression cases
- `rag_cases.jsonl`: retrieval and answer faithfulness cases
- `ml_cases.jsonl`: ML experiment and model quality cases
- `quality_gates.yaml`: release thresholds

## Faithfulness / Hallucination Gate

`EvalService.run_rag_eval` (via `python scripts/run_evals.py rag`) checks each
case in `rag_cases.jsonl` against the file it cites in `expected_source`: every
term in `expected_answer_contains` must be textually grounded in that source,
and a citation (`expected_source`) is required. A case whose golden answer
claims something the cited source does not contain fails the
`faithfulness_min` / `recall_at_k_min` gate from `quality_gates.yaml`, the same
way an unsupported claim would fail `guardrails/policy.yaml`'s
`unsupported_claim_policy: block_or_clarify`. This is a deterministic,
LLM-free proxy for faithfulness (no model call, no embeddings) — it verifies
grounding against cited text, it does not judge semantic correctness.

