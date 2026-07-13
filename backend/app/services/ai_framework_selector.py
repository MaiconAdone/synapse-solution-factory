from typing import Any

from app.repositories.ai_framework_catalog import load_ai_framework_catalog


class AiFrameworkSelector:
    def __init__(self, catalog: dict[str, Any] | None = None) -> None:
        self.catalog = catalog or load_ai_framework_catalog()

    def list_frameworks(self) -> list[dict[str, Any]]:
        return list(self.catalog["frameworks"])

    def list_technologies(self) -> list[dict[str, Any]]:
        return list(self.catalog.get("technology_catalog", self.catalog["frameworks"]))

    def select(self, request_text: str, universe: str = "hybrid") -> dict[str, Any]:
        normalized_universe = self._normalize_universe(universe)
        technology_layer = self._technology_layer(request_text, normalized_universe)
        if normalized_universe not in self.catalog["selection_policy"]["applies_to_universes"]:
            return {
                "universe": normalized_universe,
                "active": False,
                "reason": "AI framework selection is active for IA, hybrid, and Chatbolt projects only.",
                "recommended_frameworks": [],
                "scenario_classification": "ml_only",
                "technology_layer": technology_layer,
                "architecture_blueprint": self._architecture_blueprint([], technology_layer, normalized_universe),
                "pipeline_blueprints": self._pipeline_blueprints(technology_layer),
                "solution_templates": technology_layer["template_paths"],
                "evaluation_plan": self._evaluation_plan(technology_layer, normalized_universe),
                "production_risks": self._production_risks(technology_layer, normalized_universe),
            }

        text = request_text.lower()
        matched_rules = [
            rule
            for rule in self.catalog["selection_rules"]
            if any(signal.lower() in text for signal in rule["signals"])
        ]
        if matched_rules:
            framework_ids = self._dedupe(
                framework_id
                for rule in matched_rules
                for framework_id in rule["recommended"]
            )
            scenario = "+".join(rule["scenario"] for rule in matched_rules)
        else:
            framework_ids = list(self.catalog["default_recommendation"])
            scenario = "default_ai_solution"

        frameworks = [
            framework
            for framework in self.catalog["frameworks"]
            if framework["id"] in framework_ids
        ]

        return {
            "universe": normalized_universe,
            "active": True,
            "scenario_classification": scenario,
            "recommended_frameworks": frameworks,
            "recommended_framework_ids": framework_ids,
            "agent_blueprint": self._blueprint(framework_ids, "agents"),
            "rag_blueprint": self._blueprint(framework_ids, "rag"),
            "llm_blueprint": self._blueprint(framework_ids, "llm"),
            "mcp_blueprint": self._blueprint(framework_ids, "mcp"),
            "selection_gate": self.catalog["selection_policy"]["selection_outputs"],
            "book_alignment": self.catalog["book_alignment"],
            "technology_layer": technology_layer,
            "architecture_blueprint": self._architecture_blueprint(framework_ids, technology_layer, normalized_universe),
            "pipeline_blueprints": self._pipeline_blueprints(technology_layer),
            "solution_templates": technology_layer["template_paths"],
            "evaluation_plan": self._evaluation_plan(technology_layer, normalized_universe),
            "production_risks": self._production_risks(technology_layer, normalized_universe),
        }

    def _blueprint(self, framework_ids: list[str], capability: str) -> dict[str, Any]:
        matching = [
            framework["id"]
            for framework in self.catalog["frameworks"]
            if framework["id"] in framework_ids and capability in framework["capabilities"]
        ]
        return {
            "capability": capability,
            "candidate_frameworks": matching,
            "requires_sdd": self.catalog["selection_policy"]["sdd_required_before_implementation"],
            "requires_evals": True,
            "requires_observability": True,
            "requires_guardrails": True,
        }

    def _technology_layer(self, request_text: str, universe: str) -> dict[str, Any]:
        text = request_text.lower()
        technologies = self.list_technologies()
        matched = [
            technology
            for technology in technologies
            if self._technology_matches(text, technology)
        ]
        if not matched:
            defaults = set(self.catalog.get("default_technology_recommendation", []))
            matched = [technology for technology in technologies if technology["id"] in defaults]
        if universe in {"ml", "hybrid"}:
            matched = self._with_required_technology(matched, technologies, "mlflow")
        if universe in {"ia", "chatbolt", "hybrid"}:
            for required_id in ["fastapi", "ollama", "mcp-servers"]:
                matched = self._with_required_technology(matched, technologies, required_id)

        technology_ids = self._dedupe(technology["id"] for technology in matched)
        selected = [technology for technology in technologies if technology["id"] in technology_ids]
        return {
            "schema": "synapse-technology-layer.v1",
            "active": True,
            "universe": universe,
            "recommended_technology_ids": technology_ids,
            "recommended_technologies": selected,
            "categories": self._dedupe(technology["category"] for technology in selected),
            "capabilities": self._dedupe(
                capability
                for technology in selected
                for capability in technology.get("capabilities", [])
            ),
            "template_paths": self._dedupe(
                template
                for technology in selected
                for template in technology.get("templates", [])
            ),
            "selection_reason": "Selected by business-problem signals, universe requirements, and local-first Synapse defaults.",
        }

    def _technology_matches(self, text: str, technology: dict[str, Any]) -> bool:
        signals = [
            technology.get("id", ""),
            technology.get("name", ""),
            technology.get("category", ""),
            *technology.get("capabilities", []),
            *technology.get("best_for", []),
            *technology.get("select_when", []),
        ]
        return any(signal and signal.lower().replace("_", " ") in text for signal in signals)

    def _with_required_technology(
        self,
        selected: list[dict[str, Any]],
        technologies: list[dict[str, Any]],
        technology_id: str,
    ) -> list[dict[str, Any]]:
        if any(technology["id"] == technology_id for technology in selected):
            return selected
        required = next((technology for technology in technologies if technology["id"] == technology_id), None)
        return [*selected, required] if required else selected

    def _architecture_blueprint(
        self,
        framework_ids: list[str],
        technology_layer: dict[str, Any],
        universe: str,
    ) -> dict[str, Any]:
        capabilities = set(technology_layer["capabilities"])
        components = ["api_gateway", "governance", "tests", "evals", "observability"]
        if "rag" in capabilities:
            components.extend(["ingestion_pipeline", "retrieval_service", "citation_evals"])
        if "agents" in capabilities:
            components.extend(["agent_orchestrator", "tool_boundary", "human_approval_gate"])
        if "automation" in capabilities:
            components.append("automation_workflows")
        if "knowledge_graph" in capabilities:
            components.extend(["graph_schema", "entity_resolution", "graph_retrieval"])
        if universe in {"ml", "hybrid"}:
            components.extend(["experiment_tracking", "model_registry", "drift_monitoring"])
        return {
            "style": {
                "ml": "mlops_service_architecture",
                "ia": "rag_agentic_service_architecture",
                "chatbolt": "conversational_rag_agent_architecture",
                "hybrid": "hybrid_mlops_rag_agent_architecture",
            }.get(universe, "hybrid_mlops_rag_agent_architecture"),
            "framework_ids": framework_ids,
            "technology_ids": technology_layer["recommended_technology_ids"],
            "components": self._dedupe(components),
            "local_first": True,
            "cloud_requires_explicit_approval": True,
        }

    def _pipeline_blueprints(self, technology_layer: dict[str, Any]) -> list[dict[str, Any]]:
        capabilities = set(technology_layer["capabilities"])
        pipelines = [
            {
                "id": "solution_discovery",
                "stages": ["business_problem", "universe_classification", "technology_selection", "sdd_gate"],
            }
        ]
        if {"web_ingestion", "crawl", "scrape"} & capabilities:
            pipelines.append({"id": "web_ingestion", "stages": ["crawl", "clean", "chunk", "index", "quality_check"]})
        if "rag" in capabilities:
            pipelines.append({"id": "rag", "stages": ["ingest", "embed", "retrieve", "rerank", "answer", "evaluate"]})
        if "agents" in capabilities:
            pipelines.append({"id": "agentic_execution", "stages": ["plan", "select_tools", "execute", "review", "record_memory"]})
        if "automation" in capabilities:
            pipelines.append({"id": "automation", "stages": ["trigger", "transform", "call_service", "notify", "audit"]})
        if "experiments" in capabilities:
            pipelines.append({"id": "mlops", "stages": ["baseline", "train", "track", "register", "monitor"]})
        return pipelines

    def _evaluation_plan(self, technology_layer: dict[str, Any], universe: str) -> list[str]:
        capabilities = set(technology_layer["capabilities"])
        evals = ["contract_tests", "latency_and_cost_budget", "security_and_tool_boundary_checks"]
        if "rag" in capabilities:
            evals.extend(["groundedness", "citation_precision", "retrieval_recall"])
        if "agents" in capabilities:
            evals.extend(["task_success_rate", "tool_call_trace_review", "human_approval_thresholds"])
        if universe in {"ml", "hybrid"}:
            evals.extend(["baseline_metric_comparison", "model_card_review", "drift_checks"])
        return self._dedupe(evals)

    def _production_risks(self, technology_layer: dict[str, Any], universe: str) -> list[str]:
        risks = ["cost_growth", "prompt_or_pipeline_regression", "secret_leakage_through_tools"]
        capabilities = set(technology_layer["capabilities"])
        if "web_ingestion" in capabilities:
            risks.append("source_quality_and_crawl_compliance")
        if "knowledge_graph" in capabilities:
            risks.append("entity_resolution_errors")
        if "visual_flows" in capabilities:
            risks.append("operator_changes_without_code_review")
        if universe in {"ia", "chatbolt", "hybrid"}:
            risks.append("ungrounded_llm_answers")
        return self._dedupe(risks)

    def _normalize_universe(self, value: str) -> str:
        normalized = value.strip().lower()
        if normalized in {"ia", "ai", "agents", "rag"}:
            return "ia"
        if normalized in {"chatbolt", "chat-bolt", "chat-bolt-system", "enterprise-chatbolt-agentic-system"}:
            return "chatbolt"
        if normalized in {"hybrid", "hibrido", "ml + ia (hibrido)", "ml-ia-hibrido", "ai-ml-agents"}:
            return "hybrid"
        return "ml"

    def _dedupe(self, values) -> list[str]:
        seen = set()
        result = []
        for value in values:
            if value not in seen:
                seen.add(value)
                result.append(value)
        return result
