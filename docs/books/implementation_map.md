# Book-Inspired Implementation Map

This project does not copy book content. It translates broad engineering
lessons into executable project contracts.

<!-- book-registry:start -->
## Registro De Livros

Gerado de `config/book_registry.json` por `scripts/sync_book_registry.py`; edite o registro, nao esta tabela.

| Livro | Autores | Dominios | Universos | Aplicado em |
|-------|---------|----------|-----------|-------------|
| *AI Engineering* | Chip Huyen | ia, evaluation | ml, ia, chatbolt, hybrid | `evals/quality_gates.yaml`, `playbooks/ai_engineering.md`, `config/fine_tuning_policy.json`, `config/rag_scalability_policy.json` |
| *Designing Machine Learning Systems* | Chip Huyen | ml | ml, hybrid | `ml_systems/data_contract.yaml`, `ml_systems/monitoring_plan.yaml`, `ml_systems/model_card_template.md`, `playbooks/ml_systems.md` |
| *Foundations of Machine Learning - Lecture Notes* | user-provided local PDF | ml, statistics | ml, hybrid | `config/ml_foundations_policy.json`, `docs/specifications/ml_foundations.md` |
| *Mathematics for Machine Learning* | Marc Peter Deisenroth, A. Aldo Faisal and Cheng Soon Ong | ml, statistics | ml, ia, chatbolt, hybrid | `playbooks/math_for_ml.md`, `notebooks/foundations/foundations_lab.ipynb`, `scripts/treat_dataset.py`, `config/data_treatment_policy.json` |
| *Prompt Engineering for LLMs* | John Berryman and Albert Ziegler | ia | ia, chatbolt, hybrid | `playbooks/prompt_engineering.md`, `prompts/README.md`, `evals/prompt_cases.jsonl` |
| *LLM Engineer's Handbook* | Paul Iusztin and Maxime Labonne | ia | ia, chatbolt, hybrid | `config/rag_scalability_policy.json`, `config/fine_tuning_policy.json`, `playbooks/llm_engineering.md` |
| *Build a Large Language Model (From Scratch)* | Sebastian Raschka | ia | ia, chatbolt, hybrid | `notebooks/foundations/foundations_lab.ipynb`, `config/fine_tuning_policy.json` |
| *Building LLMs for Production* | Louis-Francois Bouchard and Louie Peters | ia | ia, chatbolt, hybrid | `playbooks/production_llms.md`, `llm_ops/release_checklist.md`, `guardrails/policy.yaml`, `config/harness_engineering_policy.json` |
| *Introduction to Algorithms* | Thomas H. Cormen, Charles E. Leiserson, Ronald L. Rivest and Clifford Stein | algorithms | ml, ia, chatbolt, hybrid | `scripts/synapse_lib/rag_retrieval.py`, `scripts/synapse_lib/rag_scalability.py`, `config/workflows/synapse/new-ai-project.json` |
| *Artificial Intelligence* | Patrick Henry Winston | agents | ml, ia, chatbolt, hybrid | `config/agentic_architectural_patterns.json`, `config/business_transformation.json` |
| *The Society of Mind* | Marvin Minsky | agents | ml, ia, chatbolt, hybrid | `config/roles.json`, `config/agentic_architectural_patterns.json` |
| *The Emotion Machine* | Marvin Minsky | agents | ml, ia, chatbolt, hybrid | `scripts/synapse_lib/business_transformation.py`, `config/harness_engineering_policy.json` |
| *Cybernetics: Or Control and Communication in the Animal and the Machine* | Norbert Wiener | agents | ml, ia, chatbolt, hybrid | `config/harness_engineering_policy.json`, `config/agent_improvement_loop.json` |
| *AI Agents in Action* | Micheal Lanham | agents | ia, chatbolt, hybrid | `config/agent_blueprint_contract.json`, `scripts/synapse_lib/solution_agents.py` |
| *AI Agents and Applications* | Roberto Infante | agents | ml, ia, chatbolt, hybrid | `config/workflows/synapse/business-transformation.json`, `config/workflows/synapse/agent-build.json` |
| *Building Applications with AI Agents* | Michael Albada | agents | ml, ia, chatbolt, hybrid | `config/harness_engineering_policy.json`, `scripts/synapse_lib/harness_service.py`, `config/agent_blueprint_contract.json` |
| *Agentic Architectural Patterns for Building Multi-Agent Systems* | Ali Arsanjani | agents | ml, ia, chatbolt, hybrid | `config/agentic_architectural_patterns.json`, `docs/architecture/agentic-architectural-patterns.md` |
| *Agentic Artificial Intelligence* | Pascal Bornet and Jochen Wirtz | business, agents | ml, ia, chatbolt, hybrid | `config/business_transformation.json`, `scripts/synapse_lib/business_transformation.py` |
| *Competing in the Age of AI* | Marco Iansiti and Karim R. Lakhani | business | ml, ia, chatbolt, hybrid | `config/business_transformation.json`, `docs/AGENTIC_AI_TRANSFORMATION.md` |
| *All-In on AI* | Thomas H. Davenport and Nitin Mittal | business | ml, ia, chatbolt, hybrid | `config/business_transformation.json`, `evals/business_transformation_cases.jsonl` |
| *Agentic Coding with Claude Code* | Eden Marco | agents | ml, ia, chatbolt, hybrid | `CLAUDE.md`, `AGENTS.md`, `playbooks/agentic_coding.md` |
| *Speech and Language Processing* | Daniel Jurafsky and James H. Martin | voice | hybrid | `docs/specifications/voice_agentic_coding.md`, `config/voice_agent_quality_gates.json`, `evals/voice_agent_cases.jsonl` |
| *Designing Voice User Interfaces* | Cathy Pearl | voice | hybrid | `docs/specifications/voice_agentic_coding.md`, `config/voice_agent_quality_gates.json` |
| *Effective Conversational AI* | Freed, Jacobs and Rozsa (as recorded in voice_agentic_coding.md) | voice, ia | chatbolt, hybrid | `docs/specifications/voice_agentic_coding.md`, `evals/agentic_coding_cases.jsonl` |

## Implementacao Propria (Fora Dos Livros)

Decisoes de engenharia do Synapse e praticas de mercado que nao vem dos livros acima.
Os livros dao os principios; estes numeros, regras e mecanismos sao ajustaveis.

| Id | Decisao | Base | Aplicado em |
|----|---------|------|-------------|
| `project-factory` | Dialog-first project factory with four universes, briefing gate, rollback and per-universe artifact alignment | Synapse engineering decision | `scripts/create_ai_project.ps1`, `scripts/project_factory/ProjectFactory.Common.ps1`, `scripts/diagnose_project.ps1` |
| `business-solution-analyzer` | Keyword-scored archetypes, effective universe with confirmation, ADR in JSON and Markdown | Synapse engineering decision | `scripts/synapse_lib/business_solution_analyzer.py`, `config/business_solution_catalog.json`, `scripts/analyze_business_solution.py` |
| `technology-selection` | Scenario-based framework and technology catalog with templates vs scaffold targets | market practice (framework landscape) | `config/ai_framework_selection.json`, `scripts/synapse_lib/ai_framework_selector.py`, `templates/README.md` |
| `statistical-data-treatment` | Deterministic treatment (missing, duplicates, IQR and z-score outlier flags, rare categories) with thresholds in policy | standard applied statistics | `scripts/treat_dataset.py`, `config/data_treatment_policy.json`, `prompts/master_data_treatment.md` |
| `local-model-baselines` | Local regression/classification/forecasting baselines with a JSON model registry | Synapse engineering decision | `scripts/synapse_lib/model_service.py`, `artifacts/models` |
| `deterministic-evals` | LLM-free eval suites: prompt contracts, faithfulness by grounding in the cited source, hybrid retrieval recall/MRR/nDCG | Synapse engineering decision | `scripts/synapse_lib/eval_service.py`, `scripts/run_evals.py`, `evals/quality_gates.yaml` |
| `context-filter-and-radar` | Context filter before LLM calls and market radar for tooling signals | Synapse engineering decision | `scripts/context_filter.py`, `config/context_policy.json`, `scripts/market_radar.py` |
| `peer-messaging` | Local SQLite MCP mailbox shared by Codex, Claude Code and humans | Synapse engineering decision | `scripts/synapse_peers_mcp.py`, `scripts/synapse_lib/peer_messaging_service.py`, `docs/architecture/peer-messaging.md` |
| `roles-and-cost-profiles` | Single assistant per task, workflow roles, request profiles with model tier and token budget | Synapse engineering decision | `config/roles.json`, `config/cost_optimization_policy.json` |
| `scalable-rag-mechanics` | Scale tiers, vector DB catalog, HNSW/IVF parameters, reciprocal rank fusion (k=60, information-retrieval literature), hashing embedder, blue/green index versions | market practice and IR literature | `config/rag_scalability_policy.json`, `scripts/synapse_lib/vector_store.py`, `scripts/synapse_lib/rag_retrieval.py`, `templates/rag/vector_db_adapter.py` |
| `fine-tuning-thresholds` | Pilot/production minimums (50/500), 5% gain over baseline, human score 0.8, leakage-free hash split | Synapse engineering decision | `config/fine_tuning_policy.json`, `scripts/synapse_lib/fine_tuning_service.py`, `scripts/prepare_fine_tuning_dataset.py` |
| `harness-engineering` | Harness components per universe, loop limits, pass@k/pass^k reliability metrics (agent benchmark practice), governance migrated from the former trust framework | market practice for coding agents | `config/harness_engineering_policy.json`, `scripts/synapse_lib/harness_service.py`, `scripts/audit_harness.py` |
| `solution-agents` | Runtime agent blueprints derived from the ADR, owner roles, tools never invented, approval for external actions | Synapse engineering decision | `scripts/synapse_lib/solution_agents.py`, `scripts/scaffold_solution_agents.py`, `config/workflows/synapse/agent-build.json` |
| `business-transformation-engine` | 14-stage state machine, explicit risk thresholds (100k/1M, regulated = CRITICAL, missing factor = HIGH), prioritization weights | Synapse engineering decision | `scripts/synapse_lib/business_transformation.py`, `scripts/run_business_transformation.py`, `templates/business/transformation_brief.json` |
| `mechanical-enforcement` | Phantom-reference guard, stdlib-only analyzer and engines, validator that blocks swarm/fleet regressions | Synapse engineering decision | `tests/test_ai_engineering_extensions.py`, `scripts/validate_enterprise_stack.ps1`, `scripts/synapse_lib/text_utils.py` |
<!-- book-registry:end -->

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
- Require human approval for destructive or external actions, by risk.
- Promote prompts, models, agents, or datasets only after eval evidence exists.

## Prompt Engineering

Conceptual reference without copied text: *Prompt Engineering for LLMs*, by
John Berryman and Albert Ziegler.

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

Conceptual reference without copied text: *Building LLMs for Production*, by
Louis-Francois Bouchard and Louie Peters.

- Runtime fallbacks.
- Release checklists.
- Safety policies.
- Trace requirements.

## Designing ML Systems

Conceptual reference without copied text: *Designing Machine Learning
Systems*, by Chip Huyen.

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

Conceptual reference without copied text: *Mathematics for Machine Learning*,
by Marc Peter Deisenroth, A. Aldo Faisal and Cheng Soon Ong. Statistics used by
Synapse (sampling, confidence intervals, hypothesis checks, outlier rules in
`scripts/treat_dataset.py`) is grounded here and in the Foundations of ML notes.

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
- Prefer small, testable algorithms for project factory, RAG, memory, and workflow
  scheduling concerns.

## Agentic Coding

- Codex + Claude Code control plane.
- Explicit workflow roles.
- Persistent memory.
- Workflow validation.
- Single-assistant execution; workflow steps name the role that owns them.

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
- Keep large catalogs out of prompts; follow workflow roles instead.
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

## Voice and Conversational Agents

Conceptual references without copied text:

- *Speech and Language Processing*, by Daniel Jurafsky and James H. Martin:
  evaluate speech recognition with word accuracy and domain vocabulary.
- *Designing Voice User Interfaces*, by Cathy Pearl: explicit wake, listen,
  recognize, confirm and recover states.
- *Effective Conversational AI*: intent success and improvement from observed
  failures; also grounds the Chatbolt conversation evals.
- *Agentic Coding with Claude Code*, by Eden Marco: persistent context, MCP,
  reusable workflows and validation hooks for coding agents.

SYNAPSE application:

- `docs/specifications/voice_agentic_coding.md`,
  `config/voice_agent_quality_gates.json` and `evals/voice_agent_cases.jsonl`.
- `CLAUDE.md`, `AGENTS.md` and `playbooks/agentic_coding.md`.

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

- *Building LLMs for Production*, by Louis-Francois Bouchard and Louie Peters: reliability, monitoring,
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
