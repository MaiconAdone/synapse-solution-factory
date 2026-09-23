"""Deterministic RAG capacity planner driven by config/rag_scalability_policy.json.

It never guesses the business inputs: missing decisions are returned as
``pending_user_decisions`` so the assistant asks the user in chat.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any

SENSITIVE_LEVELS = {"confidential", "restricted", "sensitive", "high"}


@dataclass(frozen=True)
class RagScaleRequirements:
    expected_chunks: int | None = None
    embedding_dimension: int = 384
    peak_qps: float | None = None
    p95_latency_budget_ms: int | None = None
    multi_tenant: bool | None = None
    data_sensitivity: str | None = None
    hosting: str | None = None  # "self_hosted" | "managed" | None
    existing_database: str | None = None  # "postgres" | "opensearch" | "elasticsearch" | None


class RagScalabilityPlanner:
    def __init__(self, root: Path | None = None, policy: dict[str, Any] | None = None) -> None:
        self.root = root or Path(__file__).resolve().parents[2]
        if policy is None:
            policy_path = self.root / "config" / "rag_scalability_policy.json"
            if not policy_path.exists():
                policy_path = Path(__file__).resolve().parents[2] / "config" / "rag_scalability_policy.json"
            policy = json.loads(policy_path.read_text(encoding="utf-8-sig"))
        self.policy = policy

    def plan(self, requirements: RagScaleRequirements) -> dict[str, Any]:
        pending = self._pending_decisions(requirements)
        chunks = requirements.expected_chunks or 0
        tier = self._tier(chunks)
        stores, reasons = self._stores(tier, requirements)
        index_id = tier["default_index"]
        index = self.policy["index_policy"].get(index_id, {})
        return {
            "schema": "synapse-rag-scale-plan.v1",
            "status": "needs_user_decisions" if pending else "planned",
            "pending_user_decisions": pending,
            "tier": tier["id"],
            "tier_provisional": requirements.expected_chunks is None,
            "topology": tier["topology"],
            "shards": tier["shards"],
            "replicas": tier["replicas"],
            "vector_store_candidates": stores,
            "index": {"type": index_id, **{k: v for k, v in index.items() if k != "use_when"}},
            "memory_estimate": self._memory_estimate(chunks, requirements.embedding_dimension, index_id),
            "retrieval": self.policy["retrieval"],
            "chunking": {
                key: self.policy["chunking"][key]
                for key in ("strategy", "chunk_size_tokens", "chunk_overlap_tokens", "parent_child_enabled")
            },
            "isolation": self._isolation(requirements),
            "index_lifecycle": self.policy["index_lifecycle"]["reindex_strategy"],
            "reasons": reasons,
        }

    def _pending_decisions(self, requirements: RagScaleRequirements) -> list[str]:
        mapping = {
            "expected_corpus_chunks_in_12_months": requirements.expected_chunks,
            "peak_queries_per_second": requirements.peak_qps,
            "p95_retrieval_latency_budget_ms": requirements.p95_latency_budget_ms,
            "multi_tenant_isolation_required": requirements.multi_tenant,
            "data_sensitivity": requirements.data_sensitivity,
            "hosting_constraint_self_hosted_or_managed": requirements.hosting,
            "existing_database_platform": requirements.existing_database,
        }
        return [
            decision
            for decision in self.policy["required_user_decisions"]
            if mapping.get(decision) is None
        ]

    def _tier(self, chunks: int) -> dict[str, Any]:
        for tier in self.policy["scale_tiers"]:
            if tier["max_chunks"] is None or chunks <= tier["max_chunks"]:
                return tier
        return self.policy["scale_tiers"][-1]

    def _stores(self, tier: dict[str, Any], requirements: RagScaleRequirements) -> tuple[list[str], list[str]]:
        candidates = list(tier["store_candidates"])
        reasons = [f"tier {tier['id']} by expected chunk volume"]
        existing = (requirements.existing_database or "").lower()
        sensitivity = (requirements.data_sensitivity or "").lower()

        if existing == "postgres" and tier["id"] in {"local", "team"}:
            candidates = ["pgvector", *[item for item in candidates if item != "pgvector"]]
            reasons.append("existing Postgres: prefer pgvector to avoid a new service")
        if existing in {"opensearch", "elasticsearch"}:
            candidates = ["opensearch-elasticsearch", *candidates]
            reasons.append("existing search cluster supports BM25 + kNN hybrid")
        if sensitivity in SENSITIVE_LEVELS or requirements.hosting == "self_hosted":
            candidates = [item for item in candidates if item != "pinecone"]
            reasons.append("sensitive data or self-hosting: managed cloud store excluded")
        if requirements.multi_tenant:
            native = [item for item in candidates if item in {"weaviate", "qdrant", "pinecone", "milvus", "pgvector"}]
            candidates = native + [item for item in candidates if item not in native]
            reasons.append("multi-tenant: prefer stores with namespaces/tenants or strong filtering")
        if not candidates:
            candidates = ["milvus"]
            reasons.append("no candidate left after constraints; self-hosted distributed store")
        return list(dict.fromkeys(candidates)), reasons

    def _memory_estimate(self, chunks: int, dimension: int, index_id: str) -> dict[str, Any]:
        raw = chunks * dimension * 4
        m = int(self.policy["index_policy"].get("hnsw", {}).get("params", {}).get("m", 16))
        links = chunks * m * 2 * 4 if index_id.startswith("hnsw") else 0
        if index_id == "hnsw_quantized":
            raw = math.ceil(raw / 4)
        return {
            "vector_bytes": raw,
            "graph_bytes": links,
            "total_gib": round((raw + links) / 1024**3, 3),
            "assumption": "float32 vectors (int8 when quantized), excludes payload and replicas",
        }

    def _isolation(self, requirements: RagScaleRequirements) -> str:
        levels = self.policy["multi_tenancy_and_security"]["isolation_levels"]
        sensitivity = (requirements.data_sensitivity or "").lower()
        if requirements.multi_tenant and sensitivity == "restricted":
            return levels["restricted"]
        if requirements.multi_tenant and sensitivity in SENSITIVE_LEVELS:
            return levels["high"]
        return levels["low"]
