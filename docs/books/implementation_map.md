# Book-Inspired Implementation Map

This project does not copy book content. It translates broad engineering
lessons into executable project contracts.

## AI Engineering

- Evals before optimization.
- Versioned prompts, tools, data, and configs.
- Quality, cost, latency, and safety gates.
- Feedback loops that turn user outcomes, eval failures, incidents, and human
  review into backlog items before model or agent scaling.

Conceptual references without copied text:

- *AI Engineering*, by Chip Huyen: product metrics, eval systems, model
  routing, cost, latency, and feedback loops.
- Modern AI engineering work by Sebastian Raschka and others: model limits,
  embeddings, evaluation intuition, and reproducible experiments.

SYNAPSE application:

- Use Codex/OpenAI or Claude Code/Anthropic directly for triage and review.
- Require human approval only to activate all 60 agents.
- Promote prompts, models, agents, or datasets only after eval evidence exists.

## Prompt Engineering

- Prompt registry.
- Output contracts.
- Regression cases.
- Injection-aware boundaries.

## LLM Engineering

- RAG-ready architecture.
- Model routing.
- Observability.
- Guardrails and adapters.
- Tool boundaries with explicit permissions, idempotency, audit records, and
  rollback or compensation notes when actions can affect external systems.

## Building LLMs From Scratch

- Foundations notebooks for tokenization, embeddings, attention concepts, and
evaluation math.

Conceptual reference without copied text:

- Modern foundation texts such as Sebastian Raschka's work on building LLMs:
  practical intuition for tokenization, embeddings, attention, training limits,
  and evaluation.

## Production LLMs

- Runtime fallbacks.
- Release checklists.
- Safety policies.
- Trace requirements.

## Designing ML Systems

- Data contracts.
- Model cards.
- Monitoring and drift plans.
- Release workflows.

## Foundations of Machine Learning

- Map experience, task, and performance measure before choosing a model.
- Name the hypothesis space, assumptions, and bias/variance tradeoff.
- State probabilistic assumptions, calibration needs, estimation objective,
  validation strategy, regularization, and feature transformations.

Conceptual reference without copied text:

- User-provided local PDF, *Foundations of Machine Learning - Lecture Notes*:
  classical ML concepts such as hypothesis spaces, decision trees,
  probabilistic modeling, estimation, regularization, kernels, SVMs, and
  feature selection.

SYNAPSE application:

- Use `config/ml_foundations_policy.json` and
  `docs/specifications/ml_foundations.md` for ML and hybrid projects.
- Keep existing baselines, but record missing foundational candidates such as
  naive Bayes, decision tree, kNN, kernel density, and SVM when useful.
- Require the foundations gates in generated `business_solution_analysis`
  before model training or release.

## Mathematics for ML

- Similarity, probability, optimization, metrics, and confidence intervals as
engineering practices.

## Algorithms and Systems Foundations

- Workflow graphs, queues, caches, priority ordering, search, deduplication,
  and complexity budgets should use explicit data structures and measured
  tradeoffs.
- Routing decisions should prefer simple deterministic algorithms before adding
  probabilistic or multiagent reasoning.

Conceptual reference without copied text:

- *Introduction to Algorithms* (CLRS): correctness, complexity, graph
  algorithms, dynamic programming, scheduling, and data structure tradeoffs.

SYNAPSE application:

- Use deterministic workflow state around LLM calls.
- Measure cost, latency, and memory impact before adding new routing layers.
- Prefer small, testable algorithms for project factory, RAG, memory, and swarm
  scheduling concerns.

## Agentic Coding

- Codex + Claude Code control plane.
- Specialized swarm agents.
- Persistent memory.
- Workflow validation.
- One-agent-first execution, with specialist escalation only when the task
  requires another domain.
- Never activate all 60 agents by default; full activation remains an explicit,
  justified, human-approved path.

Conceptual references without copied text:

- *Artificial Intelligence*, by Patrick Winston: problem representation, search,
  planning, explanation, and decomposing complex work.
- *The Society of Mind*, by Marvin Minsky: many small specialized processes,
  conflict resolution, and synthesis through an orchestrator.
- *AI Agents in Action*, by Micheal Lanham: practical agent roles, tools,
  planning, execution, and traceability.
- *Agentic Architectural Patterns for Building Multi-Agent Systems*, by
  Dr. Ali Arsanjani: architecture patterns for orchestrators, specialist
  agents, agent-to-agent handoffs, lifecycle observability, governance and
  enterprise multi-agent system boundaries.

SYNAPSE application:

- Model agent roles as contracts: goal, tools, memory, permissions, evals, and
  stop conditions.
- Treat multiagent collaboration as a routing choice, not as the default answer.
- Keep the swarm as the local router instead of embedding large agent catalogs in
  prompts.
- Use `config/agentic_architectural_patterns.json` as the reusable pattern
  catalog for orchestrator-specialist routing, critic gates, A2A messages,
  tool gateways, model routers, shared memory retrieval and lifecycle callbacks.

## Cybernetic Feedback and Adaptive Control

- Every autonomous or semi-autonomous loop needs a signal, comparator,
  intervention rule, and audit record.
- Human authority increases with risk, irreversibility, external side effects,
  and weak evidence.
- Memory should improve future work only through approved feedback and evals.

Conceptual reference without copied text:

- *Cybernetics: Or Control and Communication in the Animal and the Machine*, by
  Norbert Wiener: feedback, control, communication, and stability.

SYNAPSE application:

- Use eval results, incidents, human feedback, and drift indicators as control
  signals.
- Route high-risk or low-confidence actions to approval before execution.
- Keep simulation-first behavior for business transformation and external
  actions until an integration is authorized.

## Cognitive State Signals

- Agent state should expose operational signals such as confidence, uncertainty,
  risk, urgency, blocked state, evidence strength, and required approval.
- These signals are engineering controls, not claims that the system has human
  emotions or agency.

Conceptual reference without copied text:

- *The Emotion Machine*, by Marvin Minsky: modes of thinking and cognitive
  control, translated here into measurable operational states.

SYNAPSE application:

- Represent state signals in workflows, audits, and review queues.
- Use state signals to decide whether to answer, retrieve more context, ask the
  user, escalate to a specialist, or stop for human approval.

## Agentic AI Applied to Enterprise Transformation

The following works are conceptual references without copied text:

- *Agentic Artificial Intelligence*, by Pascal Bornet and Jochen Wirtz:
  objective-driven agents, controlled autonomy, and human-agent collaboration.
- *Competing in the Age of AI*, by Marco Iansiti and Karim R. Lakhani:
  AI as an operational layer connecting data, decisions, and scalable processes.
- *AI Agents in Action*, by Micheal Lanham:
  practical roles, explicit tools, planning, execution, and traceability.
- *AI Agents and Applications*, by Roberto Infante:
  stateful workflows, graph orchestration, and MCP integration boundaries.
- *Artificial Intelligence*, by Patrick Winston:
  representation, search, planning, and explainable decomposition.
- *Cybernetics*, by Norbert Wiener:
  governed feedback loops, stability, and human control signals.
- *The Society of Mind* and *The Emotion Machine*, by Marvin Minsky:
  specialized processes, orchestration, and operational state signals.
- *All-In on AI*, by Thomas H. Davenport and Nitin Mittal:
  transformation portfolios, adoption, operating-model change, and value.

Governance contracts:

- `config/business_transformation.json`
- `agents/definitions/business_transformation_agents.yaml`
- `config/workflows/synapse/business-transformation.json`
- `prompts/business_transformation.md`
- `docs/AGENTIC_AI_TRANSFORMATION.md`

The specification keeps deterministic workflow state around probabilistic
reasoning. High-risk stages stop for approval, tools remain simulated until
authorized, and generated projects inherit the operational contracts as
governance data without inheriting SYNAPSE's own project-factory scripts.

## Scalable RAG and Vector Databases

- Size retrieval before building it: corpus volume, QPS, latency budget,
  tenancy, sensitivity and hosting are user decisions, not guesses.
- Pick the index by scale (flat, HNSW, quantized HNSW, IVF-PQ/DiskANN) and
  estimate memory before choosing a vector database.
- Hybrid retrieval (BM25 + dense) fused by reciprocal rank, ACL filters before
  ranking, reranking only on low confidence.
- Version indexes per embedding model, reindex blue/green, promote only when
  retrieval gates pass.

Conceptual references without copied text:

- *LLM Engineer's Handbook*, by Paul Iusztin and Maxime Labonne: feature and
  ingestion pipelines feeding a vector database, separation of training and
  inference pipelines, RAG evaluation.
- *AI Engineering*, by Chip Huyen: retrieval as a system with its own metrics,
  context construction and cost/latency tradeoffs.
- *Introduction to Algorithms* (CLRS): graph search, clustering and complexity
  budgets behind approximate nearest neighbor indexes.

SYNAPSE application:

- `config/rag_scalability_policy.json` and
  `docs/specifications/scalable_rag_vector_db.md`.
- `scripts/synapse_lib/vector_store.py`, `rag_retrieval.py` and
  `rag_scalability.py`; `templates/rag/`.
- `python scripts/run_evals.py retrieval` gates recall@k, MRR and nDCG.

## Fine-Tuning and Model Adaptation

- Adapt in order: prompt, RAG, then fine-tuning; knowledge gaps go to RAG,
  behavior gaps go to fine-tuning.
- Prefer parameter-efficient methods (LoRA/QLoRA), preference tuning and
  distillation over full fine-tuning.
- Dataset engineering is the work: dedup, leakage-free splits, PII removal,
  human-scored examples and a data card.
- Release only against a measured baseline, with no safety regression, human
  approval and rollback to the base model.

Conceptual references without copied text:

- *AI Engineering*, by Chip Huyen: when to finetune versus prompt or retrieve,
  dataset engineering and evaluation-driven adaptation.
- *LLM Engineer's Handbook*, by Paul Iusztin and Maxime Labonne: supervised
  fine-tuning, preference alignment and parameter-efficient training.
- *Build a Large Language Model (From Scratch)*, by Sebastian Raschka:
  fine-tuning for classification and instruction following and how to evaluate it.

SYNAPSE application:

- `config/fine_tuning_policy.json` and `docs/specifications/fine_tuning.md`.
- `scripts/prepare_fine_tuning_dataset.py` prepares data without training;
  `automatic_weight_updates` stays false.

## Harness Engineering

- The harness is everything around the model: context map, tools and
  permissions, loop budgets and stop conditions, verification, traces and
  feedback.
- Prove agent behavior with repeated trials: pass@k for capability, pass^k for
  reliability.
- Enforce important rules mechanically with tests and validators, not prose.

Conceptual references without copied text:

- *Production LLMs*, by Bouchard and Peters: reliability, monitoring,
  guardrails and fallbacks around model calls.
- *Building Applications with AI Agents*, by Michael Albada: agent evaluation
  and improvement loops.
- *Cybernetics*, by Norbert Wiener: feedback signals and control loops with
  human intervention thresholds.

SYNAPSE application:

- `config/harness_engineering_policy.json` and
  `docs/specifications/harness_engineering.md`.
- `scripts/audit_harness.py` and `scripts/synapse_lib/harness_service.py`;
  generated projects ship `tests/test_harness_contract.py`.
