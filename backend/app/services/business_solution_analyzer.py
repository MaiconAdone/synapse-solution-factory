import json
import re
import unicodedata
from pathlib import Path
from typing import Any

from app.services.ai_framework_selector import AiFrameworkSelector


class BusinessSolutionAnalyzer:
    def __init__(self, root: Path | None = None) -> None:
        self.root = root or Path(__file__).resolve().parents[3]
        self.catalog_path = self.root / "config" / "business_solution_catalog.json"
        if not self.catalog_path.exists():
            self.root = Path(__file__).resolve().parents[3]
            self.catalog_path = self.root / "config" / "business_solution_catalog.json"
        self.catalog = json.loads(self.catalog_path.read_text(encoding="utf-8-sig"))
        self.ml_foundations_path = self.root / "config" / "ml_foundations_policy.json"
        self.ml_foundations_policy = self._load_ml_foundations_policy()
        self.technology_selector = AiFrameworkSelector()

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
        ai_match = self._best_match(text, self.catalog["ai_archetypes"])
        domain_match = self._best_match(text, self.catalog["domains"])
        requested = self._normalize_universe(requested_universe or solution_focus or "hybrid")
        recommended = self._recommend_universe(requested, ml_match, ai_match)
        stack = self._solution_stack(recommended, ml_match, ai_match)
        technology_selection = self.technology_selector.select(text, universe=recommended)
        technology_layer = technology_selection.get("technology_layer", {})

        has_business_problem = bool((business_problem or "").strip())
        return {
            "schema": "synapse-business-solution-analysis.v1",
            "status": "analyzed" if has_business_problem else "pending_business_problem",
            "requested_universe": requested,
            "recommended_universe": recommended,
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
            "ml_foundations": self._ml_foundations(recommended, ml_match),
            "architecture_blueprint": technology_selection.get("architecture_blueprint", {}),
            "pipeline_blueprints": technology_selection.get("pipeline_blueprints", []),
            "solution_templates": technology_selection.get("solution_templates", []),
            "architecture_decision": self._architecture_decision(recommended, stack),
            "data_strategy": self._data_strategy(recommended, ml_match),
            "test_strategy": self._test_strategy(recommended),
            "eval_strategy": self._eval_strategy(recommended, ml_match, ai_match),
            "ruflo_strategy": self._ruflo_strategy(recommended),
            "book_alignment": self._book_alignment(ml_match, ai_match),
            "required_artifacts": self._required_artifacts(recommended, ml_match, ai_match),
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
        return "\n".join(
            [
                "# Business Solution Analysis",
                "",
                f"- Requested universe: {analysis['requested_universe']}",
                f"- Recommended universe: {analysis['recommended_universe']}",
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
            "policy_path": "config/ml_foundations_policy.json" if self.ml_foundations_policy else "",
            "spec_path": "docs/specifications/ml_foundations.md" if self.ml_foundations_policy else "",
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
        tests = ["tests/test_project_contract.py", "tests/test_evals_contract.py", "tests/test_data_contract.py"]
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
        if universe in {"ia", "chatbolt", "hybrid"}:
            evals.extend(["evals/prompt_cases.jsonl", "evals/rag_cases.jsonl"])
        if universe == "chatbolt":
            evals.append("evals/chatbot_cases.jsonl")
        if ai_match["item"].get("id") in {"agent", "chatbot_rag_agent"}:
            evals.append("evals/tool_workflow_cases.jsonl")
        return evals

    def _ruflo_strategy(self, universe: str) -> dict[str, Any]:
        return {
            "default": "start_with_one_orchestrator",
            "core_agents": 15,
            "max_agents": 60,
            "activate_all_60": "requires explicit high-complexity request, human approval, and cost review",
            "recommended_fleets": {
                "ml": ["ml_fleet", "data_fleet", "quality_fleet"],
                "ia": ["rag_fleet", "mcp_fleet", "security_fleet"],
                "chatbolt": ["rag_fleet", "mcp_fleet", "quality_fleet"],
                "hybrid": ["project_factory_fleet", "ml_fleet", "rag_fleet", "cost_optimization_fleet"],
            }.get(universe, ["project_factory_fleet"]),
        }

    def _required_artifacts(self, universe: str, ml_match: dict[str, Any], ai_match: dict[str, Any]) -> list[str]:
        artifacts = ["docs/briefings/business_solution_analysis.md", "config/business_solution_analysis.json"]
        artifacts.append("config/ai_framework_selection.json")
        if universe in {"ml", "hybrid"}:
            artifacts.extend(["config/ml_foundations_policy.json", "docs/specifications/ml_foundations.md"])
            artifacts.extend(ml_match["item"].get("required_artifacts", []))
        if universe in {"ia", "chatbolt", "hybrid"}:
            artifacts.extend(ai_match["item"].get("required_artifacts", []))
        artifacts.extend(self._test_strategy(universe))
        return list(dict.fromkeys(artifacts))

    def _book_alignment(self, ml_match: dict[str, Any], ai_match: dict[str, Any]) -> list[str]:
        alignment = [
            "AI Engineering: define quality, cost, latency, safety, and evaluation gates before scaling models or agents.",
            "Designing ML Systems/MLOps: use data contracts, baselines, experiment tracking, monitoring, and drift checks.",
            "LLM engineering: version prompts and context, keep provider boundaries explicit, and monitor production outcomes.",
            "Agent architecture: use bounded tools, persistent context, human approval, tests, and rollback for coding actions.",
        ]
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
