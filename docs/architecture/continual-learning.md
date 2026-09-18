# Continual Learning

SYNAPSE improves the cloud LLM experience through governed memory and retrieval.

1. `ContinualLearningService.capture_execution` captures sanitized project-scoped experiences to a local JSONL event log.
2. Approved experiences are retrieved with local keyword search over that log.
3. Similar future requests retrieve prior examples before generation.
4. Human feedback with score >= 0.8 can add an example to the local training dataset.
5. Global promotion and model-weight updates require explicit approval and evals.

The runtime never fine-tunes or replaces model weights automatically.
