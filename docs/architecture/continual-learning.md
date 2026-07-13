# Continual Learning

SYNAPSE improves the local Ollama experience through governed memory and retrieval.

1. `execute_governed_swarm` captures sanitized project-scoped experiences.
2. Ruflo stores approved retrieval memories with vector embeddings.
3. Similar future requests retrieve prior examples before Ollama generation.
4. Human feedback with score >= 0.8 can add an example to the local training dataset.
5. Global promotion and model-weight updates require explicit approval and evals.

The runtime never fine-tunes or replaces Ollama model weights automatically.
