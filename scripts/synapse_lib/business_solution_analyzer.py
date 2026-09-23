import json
import re
import unicodedata
from pathlib import Path
from typing import Any

from scripts.synapse_lib.ai_framework_selector import AiFrameworkSelector
from scripts.synapse_lib.fine_tuning_service import AdaptationAdvisor
from scripts.synapse_lib.rag_scalability import RagScalabilityPlanner, RagScaleRequirements

AI_UNIVERSES = {"ia", "chatbolt", "hybrid"}


class BusinessSolutionAnalyzer:
    def __init__(self, root: Path | None = None) -> None:
        self.root = root or Path(__file__).resolve().parents[2]
        self.catalog_path = self.root / "config" / "business_solution_catalog.json"
        if not self.catalog_path.exists():
            self.root = Path(__file__).resolve().parents[2]
            self.catalog_path = self.root / "config" / "business_solution_catalog.json"
        self.catalog = json.loads(self.catalog_path.read_text(encoding="utf-8-sig"))
        self.ml_foundations_path = self.root / "config" / "ml_foundations_policy.json"
        self.ml_foundations_policy = self._load_ml_foundations_policy()
        self.technology_selector = AiFrameworkSelector()
        self.harness_policy = self._load_optional_json("config/harness_engineering_policy.json")
        self.runtime_manifest = self._load_optional_json("config/runtime_manifest.json")
        self.transformation_contract = self._load_optional_json("config/business_transformation.json")

    def analyze(
        self,
        *,
        project_goal: str | None,
        business_problem: str | None,
        requested_universe: str,
        solution_focus: str | None = None,
        success_metric_or_acceptance_criteria: str | None = None,
        available_data_or_knowledge_sources: str | None = None,
        risk_level: str | None = None,
    ) -> dict[str, Any]:
        text = self._normalize(
            " ".join(
                [
                    project_goal or "",
                    business_problem or "",
                    solution_focus or "",
                    success_metric_or_acceptance_criteria or "",
                    available_data_or_knowledge_sources or "",
                    risk_level or "",
                ]
            )
        )
        ml_match = self._best_match(text, self.catalog["ml_archetypes"])
        ai_match = self._ai_archetype_match(text)
        domain_match = self._best_match(text, self.catalog["domains"])
        requested = self._normalize_universe(requested_universe or solution_focus or "hybrid")
        recommended = self._recommend_universe(requested, ml_match, ai_match)
        # The universe the user chose is the one the factory generates, so every
        # artifact, test, eval and role below follows it. A different
        # recommendation is advisory and must be confirmed in the chat.
        effective = requested
        stack = self._solution_stack(effective, ml_match, ai_match)
        technology_selection = self.technology_selector.select(text, universe=effective)
        technology_layer = technology_selection.get("technology_layer", {})
        if effective not in AI_UNIVERSES:
            technology_layer = self._strip_ai_templates(technology_layer)

        has_business_problem = bool((business_problem or "").strip())
        return {
            "schema": "synapse-business-solution-analysis.v1",
            "status": "analyzed" if has_business_problem else "pending_business_problem",
            "requested_universe": requested,
            "recommended_universe": recommended,
            "effective_universe": effective,
            "universe_confirmation": (
                ""
                if recommended == effective
                else f"Analyzer suggests '{recommended}' but the project is built as '{effective}'; confirm the universe with the user in chat."
            ),
            "dialog_context": {
                "project_goal": project_goal or "",
                "business_problem": business_problem or "",
                "success_metric_or_acceptance_criteria": success_metric_or_acceptance_criteria or "",
                "available_data_or_knowledge_sources": available_data_or_knowledge_sources or "",
                "risk_level": risk_level or "",
            },
            "domain": {
                "id": domain_match["item"].get("id", "general_enterprise"),
                "score": domain_match["score"],
            },
            "ml_archetype": self._public_match(ml_match),
            "ai_archetype": self._public_match(ai_match),
            "solution_stack": stack,
            "technology_layer": technology_layer,
            "ml_foundations": self._ml_foundations(effective, ml_match),
            "architecture_blueprint": technology_selection.get("architecture_blueprint", {}),
            "pipeline_blueprints": technology_selection.get("pipeline_blueprints", []),
            "solution_templates": self._templates_for_universe(effective, technology_selection.get("solution_templates", [])),
            "solution_scaffold_targets": technology_selection.get("solution_scaffold_targets", []),
            "rag_scalability": self._rag_scalability(effective, text),
            "model_adaptation": self._model_adaptation(effective, text),
            "harness_engineering": self._harness_engineering(effective),
            "solution_agents": self._solution_agents(effective, stack),
            "business_transformation": self._business_transformation(text),
            "architecture_decision": self._architecture_decision(effective, stack),
            "data_strategy": self._data_strategy(effective, ml_match),
            "test_strategy": self._test_strategy(effective),
            "eval_strategy": self._eval_strategy(effective, ml_match, ai_match),
            "execution_strategy": self._execution_strategy(effective, text),
            "book_alignment": self._book_alignment(effective, ml_match, ai_match),
            "required_artifacts": self._required_artifacts(effective, ml_match, ai_match),
        }

    def to_markdown(self, analysis: dict[str, Any]) -> str:
        stack = ", ".join(analysis["solution_stack"])
        technologies = ", ".join(analysis.get("technology_layer", {}).get("recommended_technology_ids", []))
        ml_foundations = analysis.get("ml_foundations", {})
        foundation_gates = "\n".join(
            f"- {gate['id']}: {', '.join(gate['required_outputs'])}"
            for gate in ml_foundations.get("required_reasoning_gates", [])
        )
        algorithm_guidance = ml_foundations.get("algorithm_guidance", {})
        missing_candidates = ", ".join(algorithm_guidance.get("missing_candidates_to_consider", []))
        pipelines = "\n".join(
            f"- {pipeline['id']}: {', '.join(pipeline['stages'])}"
            for pipeline in analysis.get("pipeline_blueprints", [])
        )
        templates = "\n".join(f"- {item}" for item in analysis.get("solution_templates", []))
        required = "\n".join(f"- {item}" for item in analysis["required_artifacts"])
        tests = "\n".join(f"- {item}" for item in analysis["test_strategy"])
        evals = "\n".join(f"- {item}" for item in analysis["eval_strategy"])
        books = "\n".join(f"- {item}" for item in analysis["book_alignment"])
        scaffold = "\n".join(f"- {item}" for item in analysis.get("solution_scaffold_targets", [])) or "- none"
        rag_scale = analysis.get("rag_scalability", {})
        rag_plan = rag_scale.get("plan", {})
        adaptation = analysis.get("model_adaptation", {})
        harness = analysis.get("harness_engineering", {})
        return "\n".join(
            [
                "# Business Solution Analysis",
                "",
                f"- Requested universe: {analysis['requested_universe']}",
                f"- Recommended universe: {analysis['recommended_universe']}",
                f"- Effective universe (generated): {analysis.get('effective_universe', analysis['requested_universe'])}",
                f"- Universe confirmation: {analysis.get('universe_confirmation') or 'not needed'}",
                f"- Domain: {analysis['domain']['id']} (score {analysis['domain']['score']})",
                f"- ML archetype: {analysis['ml_archetype']['id']} (score {analysis['ml_archetype']['score']})",
                f"- AI archetype: {analysis['ai_archetype']['id']} (score {analysis['ai_archetype']['score']})",
                f"- Solution stack: {stack}",
                f"- Technology layer: {technologies}",
                "",
                "## Architecture Decision",
                "",
                analysis["architecture_decision"],
                "",
                "## Technology Layer",
                "",
                "### Pipelines",
                "",
                pipelines,
                "",
                "### Templates",
                "",
                templates,
                "",
                "### Scaffold Targets",
                "",
                scaffold,
                "",
                "## Scalable RAG and Vector DB",
                "",
                f"- Active: {rag_scale.get('active', False)}",
                f"- Policy: {rag_scale.get('policy_path', '')}",
                f"- Tier: {rag_plan.get('tier', 'n/a')} ({rag_plan.get('status', 'n/a')})",
                f"- Vector store candidates: {', '.join(rag_plan.get('vector_store_candidates', []))}",
                f"- Pending user decisions: {', '.join(rag_plan.get('pending_user_decisions', [])) or 'none'}",
                "",
                "## Model Adaptation (Fine-Tuning)",
                "",
                f"- Active: {adaptation.get('active', False)}",
                f"- Recommended stage: {adaptation.get('recommended_stage', 'n/a')}",
                f"- Fine-tuning blockers: {', '.join(adaptation.get('fine_tuning_blockers', [])) or 'none'}",
                f"- Reason: {adaptation.get('reason', '')}",
                "",
                "## Solution Agents",
                "",
                f"- Active: {analysis.get('solution_agents', {}).get('active', False)}",
                f"- Architecture: {analysis.get('solution_agents', {}).get('architecture', 'n/a')}",
                f"- Blueprints: {analysis.get('solution_agents', {}).get('blueprints_path', '')}",
                "",
                "## Business Transformation",
                "",
                f"- Active: {analysis.get('business_transformation', {}).get('active', False)}",
                f"- Signals: {', '.join(analysis.get('business_transformation', {}).get('signals', [])) or 'none'}",
                f"- Workflow: {analysis.get('business_transformation', {}).get('workflow', '')}",
                "",
                "## Harness Engineering",
                "",
                f"- Policy: {harness.get('policy_path', '')}",
                f"- Components: {', '.join(harness.get('components', []))}",
                f"- Audit: {harness.get('audit_command', '')}",
                "",
                "## ML Foundations",
                "",
                f"- Active: {ml_foundations.get('active', False)}",
                f"- Policy: {ml_foundations.get('policy_path', '')}",
                f"- Algorithm candidates to consider: {missing_candidates}",
                "",
                foundation_gates,
                "",
                "## Required Artifacts",
                "",
                required,
                "",
                "## Tests",
                "",
                tests,
                "",
                "## Evals",
                "",
                evals,
                "",
                "## Book Alignment",
                "",
                books,
                "",
            ]
        )

    def _best_match(self, text: str, items: list[dict[str, Any]]) -> dict[str, Any]:
        best = {"item": {}, "score": 0, "matched_keywords": []}
        for item in items:
            matched = [keyword for keyword in item.get("keywords", []) if self._keyword_matches(text, keyword)]
            score = len(matched)
            if score > best["score"]:
                best = {"item": item, "score": score, "matched_keywords": matched}
        return best

    def _ai_archetype_match(self, text: str) -> dict[str, Any]:
        archetypes = self.catalog["ai_archetypes"]
        best = self._best_match(text, archetypes)
        matches = {item.get("id"): self._best_match(text, [item]) for item in archetypes}
        score = {archetype_id: match["score"] for archetype_id, match in matches.items()}
        composite = matches.get("chatbot_rag_agent")
        if not composite or best["item"].get("id") in {"chatbot_rag_agent", "voice_coding_agent"}:
            return best
        # A conversation that also executes actions, or a tie with the composite
        # archetype, is chatbot + RAG + agent rather than a plain chatbot or agent.
        conversational_action = score.get("chatbot", 0) > 0 and score.get("agent", 0) > 0
        tie = score.get("chatbot_rag_agent", 0) > 0 and score["chatbot_rag_agent"] >= best["score"]
        if conversational_action or tie:
            keywords = list(
                dict.fromkeys(
                    keyword
                    for archetype_id in ("chatbot_rag_agent", "chatbot", "agent", "rag")
                    for keyword in matches.get(archetype_id, {"matched_keywords": []})["matched_keywords"]
                )
            )
            return {"item": composite["item"], "score": len(keywords), "matched_keywords": keywords}
        return best

    def _public_match(self, match: dict[str, Any]) -> dict[str, Any]:
        item = match["item"]
        return {
            "id": item.get("id", "unknown"),
            "label": item.get("label", "Unknown"),
            "score": match["score"],
            "matched_keywords": match["matched_keywords"],
            "techniques": item.get("techniques", []),
            "metrics": item.get("metrics", []),
        }

    def _load_ml_foundations_policy(self) -> dict[str, Any]:
        if not self.ml_foundations_path.exists():
            return {}
        return json.loads(self.ml_foundations_path.read_text(encoding="utf-8-sig"))

    def _ml_foundations(self, universe: str, ml_match: dict[str, Any]) -> dict[str, Any]:
        active = universe in {"ml", "hybrid"} and bool(self.ml_foundations_policy)
        ml_id = ml_match["item"].get("id", "classification_scoring")
        guidance = self.ml_foundations_policy.get("algorithm_guidance", {}).get(ml_id, {})
        return {
            "active": active,
            "policy_path": "config/ml_foundations_policy.json" if active else "",
            "spec_path": "docs/specifications/ml_foundations.md" if active else "",
            "reason": (
                "Use foundational ML gates before model selection, training, evaluation, or release."
                if active
                else "Not required for non-ML universe."
            ),
            "required_reasoning_gates": self.ml_foundations_policy.get("required_reasoning_gates", []) if active else [],
            "algorithm_guidance": guidance if active else {},
            "required_artifacts": self.ml_foundations_policy.get("required_artifacts", []) if active else [],
        }

    def _recommend_universe(self, requested: str, ml_match: dict[str, Any], ai_match: dict[str, Any]) -> str:
        ml_score = ml_match["score"]
        ai_score = ai_match["score"]
        if requested == "hybrid":
            return "hybrid"
        if requested in {"ml", "ia", "chatbolt"} and max(ml_score, ai_score) == 0:
            return requested
        if ml_score > 0 and ai_score > 0:
            return "hybrid"
        if ml_score > ai_score:
            return "ml"
        if ai_score > ml_score:
            return "chatbolt" if ai_match["item"].get("id") in {"chatbot", "chatbot_rag_agent"} else "ia"
        return requested

    def _solution_stack(self, universe: str, ml_match: dict[str, Any], ai_match: dict[str, Any]) -> list[str]:
        stack = ["data_treatment", "tests", "evals", "governance"]
        if universe in {"ml", "hybrid"}:
            stack.extend(["mlops", *ml_match["item"].get("techniques", [])])
        if universe in {"ia", "chatbolt", "hybrid"}:
            ai_id = ai_match["item"].get("id")
            if universe == "chatbolt" or ai_id in {"chatbot", "chatbot_rag_agent"}:
                stack.append("chatbot")
            if universe in {"ia", "hybrid"} or ai_id in {"rag", "chatbot_rag_agent"}:
                stack.append("rag")
            if universe in {"ia", "hybrid"} or ai_id in {"agent", "chatbot_rag_agent"}:
                stack.append("agents")
            stack.extend(["guardrails", "token_cost_control", "local_llm_routing"])
        return list(dict.fromkeys(stack))

    def _architecture_decision(self, universe: str, stack: list[str]) -> str:
        if universe == "ml":
            return "Create an MLOps project focused on structured data, baseline modeling, experiment tracking, model card, monitoring, and deterministic release tests."
        if universe == "chatbolt":
            return "Create a conversational AI project with chatbot UX, RAG grounding when knowledge is needed, guardrails, handoff policy, and conversation evals."
        if universe == "ia":
            return "Create an AI project with RAG and/or governed agents, tool boundaries, MCP-ready integration, cost controls, and prompt/RAG/tool evals."
        return "Create a hybrid project combining MLOps with RAG/agents so predictive intelligence and task execution share data contracts, tests, evals, and governance."

    def _data_strategy(self, universe: str, ml_match: dict[str, Any]) -> dict[str, Any]:
        return {
            "data_contract_required": True,
            "baseline_required": universe in {"ml", "hybrid"},
            "monitoring_required": True,
            "primary_metrics": ml_match["item"].get("metrics", []) if universe in {"ml", "hybrid"} else ["groundedness", "task_success_rate", "cost_per_task"],
        }

    def _test_strategy(self, universe: str) -> list[str]:
        tests = [
            "tests/test_project_contract.py",
            "tests/test_evals_contract.py",
            "tests/test_data_contract.py",
            "tests/test_harness_contract.py",
        ]
        if universe in {"ml", "hybrid"}:
            tests.append("tests/test_ml_contract.py")
        if universe in {"ia", "chatbolt", "hybrid"}:
            tests.append("tests/test_ai_contract.py")
        if universe == "chatbolt":
            tests.append("tests/test_chatbot_contract.py")
        return tests

    def _eval_strategy(self, universe: str, ml_match: dict[str, Any], ai_match: dict[str, Any]) -> list[str]:
        evals = ["evals/project_cases.jsonl", "evals/quality_gates.yaml"]
        if universe in {"ml", "hybrid"}:
            evals.append(f"evals/ml_cases.jsonl using {', '.join(ml_match['item'].get('metrics', []))}")
        if universe in AI_UNIVERSES:
            evals.extend(
                [
                    "evals/prompt_cases.jsonl",
                    "evals/rag_cases.jsonl",
                    "evals/retrieval_cases.jsonl using recall_at_k, mrr, ndcg_at_k",
                    "evals/tool_workflow_cases.jsonl using pass^k over repeated trials",
                ]
            )
        if universe == "chatbolt":
            evals.append("evals/chatbot_cases.jsonl")
        return evals

    def _execution_strategy(self, universe: str, text: str = "") -> dict[str, Any]:
        roles = self._load_optional_json("config/roles.json")
        involved = list(roles.get("by_universe", {}).get(universe, []))
        if self._business_transformation(text)["active"]:
            involved.extend(roles.get("business_transformation_roles", []))
        return {
            "default": "single_assistant_first",
            "rule": roles.get("execution_rule", ""),
            "roles_file": "config/roles.json",
            "roles": list(dict.fromkeys(involved)),
        }

    def _business_transformation(self, text: str) -> dict[str, Any]:
        signals = [
            signal
            for signal in self.transformation_contract.get("activation_signals", [])
            if self._keyword_matches(text, signal)
        ]
        return {
            "active": bool(signals),
            "signals": signals,
            "contract": "config/business_transformation.json",
            "workflow": "config/workflows/synapse/business-transformation.json",
            "brief_template": "templates/business/transformation_brief.json",
            "run_command": "python scripts/run_business_transformation.py --brief <brief.json>",
            "rule": "Collect owner, process map, KPI baselines/targets, opportunity scores and risk factors from the user; execution stays simulated until MCP tools are authorized.",
        }

    def _strip_ai_templates(self, value: Any) -> Any:
        if isinstance(value, dict):
            return {key: self._strip_ai_templates(item) for key, item in value.items()}
        if isinstance(value, list):
            return [
                self._strip_ai_templates(item)
                for item in value
                if not (isinstance(item, str) and item.startswith(("templates/rag/", "templates/fine_tuning/")))
            ]
        return value

    def _templates_for_universe(self, universe: str, templates: list[str]) -> list[str]:
        # RAG and fine-tuning templates are removed from ML projects by the factory.
        if universe in AI_UNIVERSES:
            return templates
        return [item for item in templates if not item.startswith(("templates/rag/", "templates/fine_tuning/"))]

    def _solution_agents(self, universe: str, stack: list[str]) -> dict[str, Any]:
        if universe not in AI_UNIVERSES:
            return {"active": False, "reason": "ML universe ships models, not runtime agents."}
        multiagent = "rag" in stack and "agents" in stack
        return {
            "active": True,
            "architecture": "orchestrator_with_specialists" if multiagent else "single_agent",
            "reason": (
                "RAG plus tool execution: orchestrator delegates to a knowledge retriever and an approval-gated action executor."
                if multiagent
                else "Single agent first; escalate only when another domain, RAG or MCP is required."
            ),
            "blueprints_path": "config/solution_agents.json",
            "contract": "config/agent_blueprint_contract.json",
            "workflow": "config/workflows/synapse/agent-build.json",
            "scaffold_command": "python scripts/scaffold_solution_agents.py --project-root .",
        }

    def _rag_scalability(self, universe: str, text: str) -> dict[str, Any]:
        if universe not in AI_UNIVERSES:
            return {"active": False, "reason": "No retrieval layer in the ML universe."}
        # Only explicit mentions are used; everything else stays a pending user decision.
        requirements = RagScaleRequirements(
            existing_database=self._first_signal(
                text,
                {"postgresql": "postgres", "postgres": "postgres", "opensearch": "opensearch", "elasticsearch": "elasticsearch"},
            ),
            multi_tenant=True
            if self._first_signal(text, {"multi-tenant": 1, "multi tenant": 1, "multitenant": 1, "multiempresa": 1})
            else None,
            hosting=self._first_signal(
                text,
                {"self-hosted": "self_hosted", "on-premise": "self_hosted", "on premise": "self_hosted", "gerenciado": "managed"},
            ),
            data_sensitivity=self._first_signal(
                text,
                {
                    "restrito": "restricted",
                    "restritos": "restricted",
                    "restricted": "restricted",
                    "confidencial": "confidential",
                    "confidenciais": "confidential",
                    "confidential": "confidential",
                    "dados sensiveis": "confidential",
                    "lgpd": "confidential",
                },
            ),
        )
        return {
            "active": True,
            "policy_path": "config/rag_scalability_policy.json",
            "spec_path": "docs/specifications/scalable_rag_vector_db.md",
            "plan": RagScalabilityPlanner(root=self.root).plan(requirements),
            "rule": "Ask the user every pending decision before choosing the production vector store.",
        }

    def _model_adaptation(self, universe: str, text: str) -> dict[str, Any]:
        if universe not in AI_UNIVERSES:
            return {
                "active": False,
                "recommended_stage": "not_applicable",
                "reason": "Classical ML training is governed by config/ml_foundations_policy.json.",
            }
        advice = AdaptationAdvisor().recommend(text, universe)
        advice["policy_path"] = "config/fine_tuning_policy.json"
        advice["spec_path"] = "docs/specifications/fine_tuning.md"
        return advice

    def _harness_engineering(self, universe: str) -> dict[str, Any]:
        components = [
            component["id"]
            for component in self.harness_policy.get("components", [])
            if universe in component.get("applies_to", [])
        ]
        eval_harness = self.harness_policy.get("eval_harness", {})
        return {
            "active": bool(self.harness_policy),
            "policy_path": "config/harness_engineering_policy.json",
            "spec_path": "docs/specifications/harness_engineering.md",
            "components": components,
            "trials_per_agent_case": eval_harness.get("trials_per_agent_case", 3),
            "reliability_gate_pass_hat_k_min": eval_harness.get("reliability_gate_pass_hat_k_min", 0.8),
            "audit_command": "python scripts/audit_harness.py",
        }

    def _first_signal(self, text: str, mapping: dict[str, Any]) -> Any:
        for keyword, value in mapping.items():
            if self._keyword_matches(text, keyword):
                return value
        return None

    def _load_optional_json(self, relative_path: str) -> dict[str, Any]:
        path = self.root / relative_path
        if not path.exists():
            return {}
        return json.loads(path.read_text(encoding="utf-8-sig"))

    def _required_artifacts(self, universe: str, ml_match: dict[str, Any], ai_match: dict[str, Any]) -> list[str]:
        artifacts = ["docs/briefings/business_solution_analysis.md", "config/business_solution_analysis.json"]
        if universe in AI_UNIVERSES:
            artifacts.append("config/ai_framework_selection.json")
        if universe in {"ml", "hybrid"}:
            artifacts.extend(["config/ml_foundations_policy.json", "docs/specifications/ml_foundations.md"])
            artifacts.extend(ml_match["item"].get("required_artifacts", []))
        if universe in AI_UNIVERSES:
            # Chatbot artifacts are generated only for the Chatbolt universe.
            artifacts.extend(
                artifact
                for artifact in ai_match["item"].get("required_artifacts", [])
                if universe == "chatbolt" or "chatbot" not in artifact
            )
            artifacts.append("config/solution_agents.json")
            artifacts.extend(
                [
                    "config/rag_scalability_policy.json",
                    "docs/specifications/scalable_rag_vector_db.md",
                    "evals/retrieval_cases.jsonl",
                    "config/fine_tuning_policy.json",
                    "docs/specifications/fine_tuning.md",
                    "evals/tool_workflow_cases.jsonl",
                ]
            )
        artifacts.extend(["config/harness_engineering_policy.json", "docs/specifications/harness_engineering.md"])
        artifacts.extend(self._test_strategy(universe))
        return list(dict.fromkeys(artifacts))

    def _book_alignment(self, universe: str, ml_match: dict[str, Any], ai_match: dict[str, Any]) -> list[str]:
        alignment = [
            "AI Engineering: define quality, cost, latency, safety, and evaluation gates before scaling models or agents.",
            "Designing ML Systems/MLOps: use data contracts, baselines, experiment tracking, monitoring, and drift checks.",
            "LLM engineering: version prompts and context, keep provider boundaries explicit, and monitor production outcomes.",
            "Agent architecture: use bounded tools, persistent context, human approval, tests, and rollback for coding actions.",
            "Harness engineering (Building LLMs for Production, Building Applications with AI Agents, Cybernetics): budgets, stop conditions, repeated-trial evals and feedback loops around every agent.",
        ]
        if universe in AI_UNIVERSES:
            alignment.extend(
                [
                    "Scalable RAG (LLM Engineer's Handbook, AI Engineering, Introduction to Algorithms): sized vector indexes, hybrid retrieval with rank fusion, versioned reindexing and retrieval gates.",
                    "Model adaptation (AI Engineering, LLM Engineer's Handbook, Build a Large Language Model (From Scratch)): prompt first, then RAG, then parameter-efficient fine-tuning only with a measured baseline and curated data.",
                ]
            )
        if ml_match["item"].get("id") == "speech_recognition":
            alignment.extend(
                [
                    "Speech and Language Processing: evaluate ASR with word error/accuracy, domain vocabulary, and representative speech cases.",
                    "Designing Voice User Interfaces: separate wake, listening, recognition, handling, confirmation, and recovery states.",
                    "Effective Conversational AI: measure intent success and continuously improve from observed failures instead of relying on generic fallback copy.",
                ]
            )
        if ai_match["item"].get("id") == "voice_coding_agent":
            alignment.extend(
                [
                    "Agentic Coding: engineer repository context, tool permissions, reusable workflows, validation hooks, and controlled execution.",
                    "Prompt Engineering for LLMs: compile spoken intent into an explicit objective, constraints, evidence, tools, and response contract.",
                ]
            )
        return alignment

    def _normalize_universe(self, value: str) -> str:
        normalized = self._normalize(value)
        if normalized in {"ml", "enterprise ml system"}:
            return "ml"
        if normalized in {"ia", "ai", "agents", "enterprise ai agentic system"}:
            return "ia"
        if normalized in {"chatbolt", "chat bolt", "chatbots", "enterprise chatbolt agentic system"}:
            return "chatbolt"
        return "hybrid"

    def _keyword_matches(self, text: str, keyword: str) -> bool:
        normalized = self._normalize(keyword)
        if not normalized:
            return False
        return bool(re.search(rf"(^|\W){re.escape(normalized)}(\W|$)", text))

    def _normalize(self, value: str) -> str:
        without_accents = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
        return re.sub(r"\s+", " ", without_accents.lower()).strip()
