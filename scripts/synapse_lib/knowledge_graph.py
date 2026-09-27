"""Knowledge Graph contract, local graph store and GraphRAG retriever.

Production graph databases (Neo4j, Kuzu, Postgres+AGE, Memgraph, Neptune)
plug in by implementing ``GraphStore``; see
templates/knowledge_graph/graph_store_adapter.py. ``InMemoryGraphStore`` is the
reference for bootstrap, offline graph evals and contract tests, following
config/knowledge_graph_policy.json.

``GraphRagRetriever`` composes the existing ``HybridRetriever`` without
changing it: text retrieval runs first, then entity linking and bounded graph
expansion re-rank the candidates with reciprocal rank fusion. Graph expansion
only happens for relationship questions (``QueryRouter``).
"""

from __future__ import annotations

import json
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, Any, Iterable, Protocol

from scripts.synapse_lib.knowledge_strategy import QueryRouter, load_policy
from scripts.synapse_lib.text_utils import normalize_text, tokenize

if TYPE_CHECKING:  # keep this module stdlib-only at import time
    from scripts.synapse_lib.rag_retrieval import HybridRetriever, RetrievedChunk


class KnowledgeGraphError(ValueError):
    pass


@dataclass
class Entity:
    id: str
    type: str
    name: str
    aliases: list[str] = field(default_factory=list)
    source_ids: list[str] = field(default_factory=list)
    permissions: list[str] = field(default_factory=list)
    properties: dict[str, Any] = field(default_factory=dict)

    def surface_forms(self) -> list[str]:
        return list(dict.fromkeys(normalize_text(form) for form in [self.name, *self.aliases] if form.strip()))


@dataclass(frozen=True)
class Relation:
    source: str
    target: str
    type: str
    source_ids: tuple[str, ...] = ()
    confidence: float = 1.0
    permissions: tuple[str, ...] = ()

    def key(self) -> tuple[str, str, str]:
        return (self.source, self.type, self.target)


def is_visible(permissions: Iterable[str], principals: set[str] | None) -> bool:
    """Same ACL rule as vector_store.is_allowed: no permissions means public."""
    permissions = set(permissions)
    return not permissions or bool(permissions & (principals or set()))


class GraphStore(Protocol):
    """Adapter contract every graph database integration must honor."""

    def upsert_entity(self, entity: Entity) -> str: ...

    def upsert_relation(self, relation: Relation) -> None: ...

    def get_entity(self, entity_id: str, principals: set[str] | None = None) -> Entity | None: ...

    def neighbors(self, entity_id: str, principals: set[str] | None = None) -> list[Relation]: ...

    def entities(self, principals: set[str] | None = None) -> list[Entity]: ...


class InMemoryGraphStore:
    """Property graph with entity resolution, ACL enforcement and provenance."""

    def __init__(self, auto_merge_min_confidence: float = 0.9, relation_min_confidence: float = 0.6) -> None:
        self.auto_merge_min_confidence = auto_merge_min_confidence
        self.relation_min_confidence = relation_min_confidence
        self._entities: dict[str, Entity] = {}
        self._relations: dict[tuple[str, str, str], Relation] = {}
        self._adjacency: dict[str, set[tuple[str, str, str]]] = {}
        self.review_queue: list[dict[str, Any]] = []

    # --- entity resolution -------------------------------------------------
    def resolve(self, name: str, entity_type: str | None = None) -> tuple[str | None, float]:
        """Return (entity_id, confidence): exact surface form = 1.0, else token Jaccard."""
        normalized = normalize_text(name)
        tokens = set(tokenize(name))
        best: tuple[str | None, float] = (None, 0.0)
        for entity in self._entities.values():
            if entity_type and entity.type != entity_type:
                continue
            if normalized in entity.surface_forms():
                return entity.id, 1.0
            for form in entity.surface_forms():
                other = set(form.split())
                if tokens and other:
                    score = len(tokens & other) / len(tokens | other)
                    if score > best[1]:
                        best = (entity.id, score)
        return best

    def upsert_entity(self, entity: Entity) -> str:
        """Merge into an existing entity only above the auto-merge threshold; never silently below it."""
        if entity.id in self._entities:
            self._merge(self._entities[entity.id], entity)
            return entity.id
        match_id, confidence = self.resolve(entity.name, entity.type)
        if match_id and confidence >= self.auto_merge_min_confidence:
            self._merge(self._entities[match_id], entity)
            return match_id
        if match_id and confidence > 0:
            self.review_queue.append(
                {"candidate": entity.id, "existing": match_id, "confidence": round(confidence, 3), "action": "human_review"}
            )
        self._entities[entity.id] = entity
        self._adjacency.setdefault(entity.id, set())
        return entity.id

    def _merge(self, existing: Entity, incoming: Entity) -> None:
        existing.aliases = list(dict.fromkeys([*existing.aliases, *incoming.aliases, incoming.name]))
        existing.aliases = [alias for alias in existing.aliases if normalize_text(alias) != normalize_text(existing.name)]
        existing.source_ids = list(dict.fromkeys([*existing.source_ids, *incoming.source_ids]))
        existing.permissions = list(dict.fromkeys([*existing.permissions, *incoming.permissions]))
        existing.properties = {**incoming.properties, **existing.properties}

    # --- relations ----------------------------------------------------------
    def upsert_relation(self, relation: Relation) -> None:
        if relation.source not in self._entities or relation.target not in self._entities:
            raise KnowledgeGraphError(f"relation endpoints must exist: {relation.key()}")
        if not relation.source_ids:
            raise KnowledgeGraphError(f"relation without provenance (source_ids): {relation.key()}")
        if relation.confidence < self.relation_min_confidence:
            self.review_queue.append({"relation": list(relation.key()), "confidence": relation.confidence, "action": "human_review"})
            return
        self._relations[relation.key()] = relation
        self._adjacency[relation.source].add(relation.key())
        self._adjacency[relation.target].add(relation.key())

    # --- reads (ACL enforced here, never in the prompt) ---------------------
    def get_entity(self, entity_id: str, principals: set[str] | None = None) -> Entity | None:
        entity = self._entities.get(entity_id)
        return entity if entity and is_visible(entity.permissions, principals) else None

    def entities(self, principals: set[str] | None = None) -> list[Entity]:
        return [entity for entity in self._entities.values() if is_visible(entity.permissions, principals)]

    def neighbors(self, entity_id: str, principals: set[str] | None = None) -> list[Relation]:
        visible = []
        for key in sorted(self._adjacency.get(entity_id, set())):
            relation = self._relations[key]
            other = relation.target if relation.source == entity_id else relation.source
            if is_visible(relation.permissions, principals) and self.get_entity(other, principals):
                visible.append(relation)
        return visible

    def counts(self) -> dict[str, int]:
        return {"entities": len(self._entities), "relations": len(self._relations), "review_queue": len(self.review_queue)}


# --- graph algorithms (work on any GraphStore) ---------------------------------

def link_entities(store: GraphStore, text: str, principals: set[str] | None = None) -> list[str]:
    """Find entities whose name or alias appears in the text; longer surface forms win overlaps."""
    normalized = f" {normalize_text(text)} "
    hits: list[tuple[int, int, str]] = []
    for entity in store.entities(principals):
        for form in entity.surface_forms():
            position = normalized.find(f" {form} ")
            if position >= 0:
                hits.append((position, len(form), entity.id))
    hits.sort(key=lambda item: (-item[1], item[0]))
    taken: list[tuple[int, int]] = []
    linked: list[tuple[int, str]] = []
    for position, length, entity_id in hits:
        span = (position, position + length)
        if any(span[0] < end and start < span[1] for start, end in taken) or entity_id in {eid for _, eid in linked}:
            continue
        taken.append(span)
        linked.append((position, entity_id))
    return [entity_id for _, entity_id in sorted(linked)]


def expand(
    store: GraphStore,
    seeds: list[str],
    max_hops: int = 2,
    max_entities: int = 25,
    principals: set[str] | None = None,
) -> tuple[dict[str, int], list[Relation]]:
    """Breadth-first expansion: returns {entity_id: hop} and the relations traversed."""
    hops: dict[str, int] = {seed: 0 for seed in seeds if store.get_entity(seed, principals)}
    relations: dict[tuple[str, str, str], Relation] = {}
    queue = deque(hops)
    while queue:
        current = queue.popleft()
        if hops[current] >= max_hops:
            continue
        for relation in store.neighbors(current, principals):
            relations[relation.key()] = relation
            other = relation.target if relation.source == current else relation.source
            if other not in hops and len(hops) < max_entities:
                hops[other] = hops[current] + 1
                queue.append(other)
    return hops, list(relations.values())


def shortest_path(
    store: GraphStore, start: str, goal: str, max_hops: int = 3, principals: set[str] | None = None
) -> list[Relation] | None:
    """Undirected shortest path of at most max_hops relations, or None."""
    if not (store.get_entity(start, principals) and store.get_entity(goal, principals)):
        return None
    previous: dict[str, tuple[str, Relation] | None] = {start: None}
    frontier = deque([(start, 0)])
    while frontier:
        current, depth = frontier.popleft()
        if current == goal:
            path: list[Relation] = []
            while previous[current] is not None:
                parent, relation = previous[current]  # type: ignore[misc]
                path.append(relation)
                current = parent
            return list(reversed(path))
        if depth >= max_hops:
            continue
        for relation in store.neighbors(current, principals):
            other = relation.target if relation.source == current else relation.source
            if other not in previous:
                previous[other] = (current, relation)
                frontier.append((other, depth + 1))
    return None


def load_graph(store: GraphStore, path: Path) -> dict[str, int]:
    """Load entities/relations from a JSON file shaped like templates/knowledge_graph/example_graph.json."""
    data = json.loads(path.read_text(encoding="utf-8-sig"))
    for item in data.get("entities", []):
        store.upsert_entity(
            Entity(
                id=item["id"],
                type=item["type"],
                name=item["name"],
                aliases=list(item.get("aliases", [])),
                source_ids=list(item.get("source_ids", [])),
                permissions=list(item.get("permissions", [])),
                properties=dict(item.get("properties", {})),
            )
        )
    for item in data.get("relations", []):
        store.upsert_relation(
            Relation(
                source=item["source"],
                target=item["target"],
                type=item["type"],
                source_ids=tuple(item.get("source_ids", [])),
                confidence=float(item.get("confidence", 1.0)),
                permissions=tuple(item.get("permissions", [])),
            )
        )
    return {"entities": len(data.get("entities", [])), "relations": len(data.get("relations", []))}


def relation_fact(store: GraphStore, relation: Relation, principals: set[str] | None = None) -> dict[str, Any]:
    source = store.get_entity(relation.source, principals)
    target = store.get_entity(relation.target, principals)
    return {
        "subject": source.name if source else relation.source,
        "predicate": relation.type,
        "object": target.name if target else relation.target,
        "source_ids": list(relation.source_ids),
        "confidence": relation.confidence,
    }


# --- GraphRAG -------------------------------------------------------------------

@dataclass
class GraphRetrievalResult:
    query: str
    strategy: str
    chunks: list[Any]
    linked_entities: list[str]
    facts: list[dict[str, Any]]
    paths: list[list[dict[str, Any]]]
    route: dict[str, Any]
    diagnostics: dict[str, Any] = field(default_factory=dict)

    def sources(self) -> list[str]:
        chunk_sources = [chunk.metadata.get("source_id", "") for chunk in self.chunks]
        fact_sources = [source for fact in self.facts for source in fact["source_ids"]]
        return list(dict.fromkeys(source for source in chunk_sources + fact_sources if source))


class GraphRagRetriever:
    """Hybrid text retrieval + entity linking + bounded graph expansion, fused with RRF."""

    def __init__(
        self,
        text_retriever: HybridRetriever,
        graph: GraphStore,
        policy: dict[str, Any] | None = None,
        candidate_pool: int = 30,
    ) -> None:
        self.text_retriever = text_retriever
        self.graph = graph
        self.policy = policy if policy is not None else load_policy()
        self.router = QueryRouter(self.policy)
        settings = self.policy["graph_retrieval"]
        self.max_hops = int(settings["max_hops"])
        self.max_entities = int(settings["max_expanded_entities"])
        self.rrf_k = int(settings["rrf_k"])
        self.candidate_pool = candidate_pool

    def retrieve(
        self,
        query: str,
        k: int = 6,
        filters: dict[str, Any] | None = None,
        principals: set[str] | None = None,
    ) -> GraphRetrievalResult:
        from scripts.synapse_lib.rag_retrieval import reciprocal_rank_fusion  # noqa: PLC0415

        linked = link_entities(self.graph, query, principals)
        route = self.router.route(query, len(linked))
        text = self.text_retriever.retrieve(query, k=max(k, self.candidate_pool), filters=filters, principals=principals)
        if route["strategy"] == "rag":
            return GraphRetrievalResult(query, "rag", text.chunks[:k], linked, [], [], route, {"low_confidence": text.low_confidence})

        hops, relations = expand(self.graph, linked, self.max_hops, self.max_entities, principals)
        paths = []
        for start, goal in zip(linked, linked[1:]):
            path = shortest_path(self.graph, start, goal, self.max_hops + 1, principals)
            if path:
                paths.append([relation_fact(self.graph, relation, principals) for relation in path])
        facts = [relation_fact(self.graph, relation, principals) for relation in relations]

        # Graph ranking of the ACL-filtered text candidates: provenance of traversed
        # relations first, then mentions of expanded entities weighted by closeness.
        relation_sources = {source for relation in relations for source in relation.source_ids}
        forms = {
            entity_id: entity.surface_forms()
            for entity_id in hops
            if (entity := self.graph.get_entity(entity_id, principals))
        }

        def graph_score(chunk: RetrievedChunk) -> float:
            normalized = f" {normalize_text(chunk.text)} "
            score = 2.0 if chunk.metadata.get("source_id") in relation_sources else 0.0
            for entity_id, surface in forms.items():
                if any(f" {form} " in normalized for form in surface):
                    score += 1.0 / (1 + hops[entity_id])
            return score

        scored = [(graph_score(chunk), chunk) for chunk in text.chunks]
        graph_ranking = [chunk.id for score, chunk in sorted(scored, key=lambda item: -item[0]) if score > 0]
        text_ranking = [chunk.id for chunk in text.chunks]
        by_id = {chunk.id: chunk for chunk in text.chunks}
        fused = reciprocal_rank_fusion([text_ranking, graph_ranking], k=self.rrf_k)[:k]
        chunks = [by_id[chunk_id] for chunk_id, _ in fused]
        return GraphRetrievalResult(
            query=query,
            strategy="graph_rag",
            chunks=chunks,
            linked_entities=linked,
            facts=facts,
            paths=paths,
            route=route,
            diagnostics={
                "expanded_entities": len(hops),
                "relations_traversed": len(relations),
                "graph_ranked_chunks": len(graph_ranking),
                "low_confidence": text.low_confidence,
            },
        )
