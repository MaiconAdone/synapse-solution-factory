"""Deterministic RAG vs Knowledge Graph vs GraphRAG planner.

Driven by config/knowledge_graph_policy.json. Stdlib-only on purpose: the
business solution analyzer imports it and runs under whatever ``python`` the
project factory finds on PATH. Missing business inputs are returned as
``pending_user_decisions`` so the assistant asks the user in chat.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from scripts.synapse_lib.text_utils import normalize_text

SENSITIVE_LEVELS = {"confidential", "restricted", "sensitive", "high"}
STRATEGIES = ("rag", "knowledge_graph", "graph_rag")


@dataclass(frozen=True)
class KnowledgeGraphRequirements:
    ontology_owner: str | None = None
    entity_and_relation_types: list[str] | None = None
    entity_sources_of_truth: list[str] | None = None
    graph_update_frequency: str | None = None
    expected_entities: int | None = None
    hosting: str | None = None  # "self_hosted" | "managed" | None
    existing_database: str | None = None  # "postgres" | None
    data_sensitivity: str | None = None


def load_policy(root: Path | None = None) -> dict[str, Any]:
    base = root or Path(__file__).resolve().parents[2]
    path = base / "config" / "knowledge_graph_policy.json"
    if not path.exists():
        path = Path(__file__).resolve().parents[2] / "config" / "knowledge_graph_policy.json"
    return json.loads(path.read_text(encoding="utf-8-sig"))


def _contains(text: str, keyword: str) -> bool:
    normalized = normalize_text(keyword)
    return bool(normalized) and bool(re.search(rf"(^|\W){re.escape(normalized)}(\W|$)", text))


class KnowledgeStrategyPlanner:
    def __init__(self, root: Path | None = None, policy: dict[str, Any] | None = None) -> None:
        self.policy = policy if policy is not None else load_policy(root)

    def detect_signals(self, text: str) -> dict[str, list[str]]:
        normalized = normalize_text(text)
        return {
            group: [keyword for keyword in keywords if _contains(normalized, keyword)]
            for group, keywords in self.policy["signals"].items()
        }

    def choose_strategy(self, text: str) -> tuple[str, dict[str, list[str]], list[str]]:
        rules = self.policy["decision_rules"]
        signals = self.detect_signals(text)
        graph_groups = [group for group in rules["graph_signal_groups"] if signals.get(group)]
        has_text = bool(signals.get(rules["text_signal_group"]))
        normalized = normalize_text(text)
        explicit = [term for term in rules["explicit_graph_terms_force_graph"] if _contains(normalized, term)]
        reasons: list[str] = []
        if len(graph_groups) >= int(rules["min_graph_signal_groups"]) or explicit:
            strategy = "graph_rag" if has_text else "knowledge_graph"
            if explicit:
                reasons.append(f"explicit graph request: {', '.join(explicit)}")
            if graph_groups:
                reasons.append(f"graph signal groups: {', '.join(graph_groups)}")
            reasons.append(
                "unstructured documents also present: fuse text retrieval with graph expansion"
                if has_text
                else "no unstructured-text signal: structured graph is the primary knowledge layer"
            )
        else:
            strategy = self.policy.get("default_strategy", "rag")
            reasons.append(
                f"graph signal groups {graph_groups or 'none'} below minimum "
                f"{rules['min_graph_signal_groups']}: vector/hybrid RAG is enough and cheapest"
            )
        return strategy, signals, reasons

    def plan(self, text: str, requirements: KnowledgeGraphRequirements | None = None) -> dict[str, Any]:
        requirements = requirements or KnowledgeGraphRequirements()
        strategy, signals, reasons = self.choose_strategy(text)
        uses_graph = strategy != "rag"
        pending = self._pending_decisions(requirements) if uses_graph else []
        plan: dict[str, Any] = {
            "schema": "synapse-knowledge-strategy.v1",
            "strategy": strategy,
            "status": "needs_user_decisions" if pending else "planned",
            "uses_graph": uses_graph,
            "signals": {group: hits for group, hits in signals.items() if hits},
            "reasons": reasons,
            "pending_user_decisions": pending,
            "strategy_profile": self.policy["strategies"][strategy],
        }
        if uses_graph:
            tier, stores, store_reasons = self._stores(requirements)
            plan.update(
                {
                    "graph_store_tier": tier["id"],
                    "graph_store_tier_provisional": requirements.expected_entities is None,
                    "graph_store_candidates": stores,
                    "graph_schema": self.policy["graph_schema"],
                    "entity_resolution": self.policy["entity_resolution"],
                    "graph_retrieval": self.policy["graph_retrieval"],
                    "evaluation": self.policy["evaluation"],
                }
            )
            plan["reasons"] = reasons + store_reasons
        return plan

    def _pending_decisions(self, requirements: KnowledgeGraphRequirements) -> list[str]:
        mapping = {
            "ontology_owner": requirements.ontology_owner,
            "entity_and_relation_types": requirements.entity_and_relation_types,
            "entity_sources_of_truth": requirements.entity_sources_of_truth,
            "graph_update_frequency": requirements.graph_update_frequency,
            "expected_entities_in_12_months": requirements.expected_entities,
            "graph_store_hosting_self_hosted_or_managed": requirements.hosting,
        }
        return [decision for decision in self.policy["required_user_decisions"] if not mapping.get(decision)]

    def _stores(self, requirements: KnowledgeGraphRequirements) -> tuple[dict[str, Any], list[str], list[str]]:
        entities = requirements.expected_entities or 0
        tier = self.policy["store_tiers"][-1]
        for candidate in self.policy["store_tiers"]:
            if candidate["max_entities"] is None or entities <= candidate["max_entities"]:
                tier = candidate
                break
        stores = list(tier["store_candidates"])
        reasons = [f"graph tier {tier['id']} by expected entity volume"]
        if (requirements.existing_database or "").lower() == "postgres" and tier["id"] in {"local", "team"}:
            stores = ["postgres-age", *[store for store in stores if store != "postgres-age"]]
            reasons.append("existing Postgres: prefer Apache AGE to avoid a new service")
        sensitivity = (requirements.data_sensitivity or "").lower()
        if requirements.hosting == "self_hosted" or sensitivity in SENSITIVE_LEVELS:
            catalog = self.policy["graph_store_catalog"]
            stores = [store for store in stores if not catalog.get(store, {}).get("managed")]
            reasons.append("sensitive data or self-hosting: managed graph stores excluded")
        if not stores:
            stores = ["neo4j"]
            reasons.append("no candidate left after constraints; self-hosted Neo4j")
        return tier, list(dict.fromkeys(stores)), reasons


class QueryRouter:
    """Per-question routing inside graph_rag projects (graph only for relationship questions)."""

    def __init__(self, policy: dict[str, Any] | None = None, root: Path | None = None) -> None:
        self.policy = policy if policy is not None else load_policy(root)
        routing = self.policy["query_routing"]
        self.cues = routing["relationship_cues"]
        self.min_linked = int(routing.get("min_linked_entities_for_graph", 1))

    def route(self, query: str, linked_entities: int = 0) -> dict[str, Any]:
        normalized = normalize_text(query)
        cues = [cue for cue in self.cues if _contains(normalized, cue)]
        use_graph = bool(cues) and linked_entities >= self.min_linked
        if use_graph:
            reason = "relationship question with linked entities"
        elif cues:
            reason = f"relationship cue but only {linked_entities} linked entities"
        else:
            reason = "no relationship cue"
        return {"strategy": "graph_rag" if use_graph else "rag", "cues": cues, "reason": reason}
