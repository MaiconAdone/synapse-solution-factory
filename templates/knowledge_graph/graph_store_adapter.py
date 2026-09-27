"""Production graph store adapter skeletons implementing the GraphStore
protocol from scripts/synapse_lib/knowledge_graph.py.

Pick the store chosen by KnowledgeStrategyPlanner, install its client in the
generated project only (not in Synapse), load the schema from
templates/knowledge_graph/graph_schema.yaml and run `python scripts/run_evals.py
graph` against it before serving.

Rules enforced by every adapter (config/knowledge_graph_policy.json):
- every relation carries provenance (source_ids) and a confidence;
- ACL (permissions) is filtered inside the database query, never in the prompt;
- entity ids are stable so re-ingestion is an idempotent MERGE;
- merges below the auto-merge confidence go to human review, never silently.
"""

from __future__ import annotations

from typing import Any

from scripts.synapse_lib.knowledge_graph import Entity, KnowledgeGraphError, Relation

ACL_CLAUSE = "(size(coalesce({var}.permissions, [])) = 0 OR any(p IN {var}.permissions WHERE p IN $principals))"


def _entity(record: Any) -> Entity:
    return Entity(
        id=record["id"],
        type=record["type"],
        name=record["name"],
        aliases=list(record.get("aliases") or []),
        source_ids=list(record.get("source_ids") or []),
        permissions=list(record.get("permissions") or []),
    )


class Neo4jGraphStore:
    """Neo4j adapter (requires: pip install neo4j). Also works with Memgraph (Bolt + Cypher)."""

    def __init__(self, uri: str, user: str, password: str, database: str = "neo4j") -> None:
        from neo4j import GraphDatabase  # noqa: PLC0415 - optional dependency of generated projects

        self.driver = GraphDatabase.driver(uri, auth=(user, password))
        self.database = database

    def ensure_schema(self) -> None:
        self._run("CREATE CONSTRAINT entity_id IF NOT EXISTS FOR (e:Entity) REQUIRE e.id IS UNIQUE")

    def upsert_entity(self, entity: Entity) -> str:
        self._run(
            "MERGE (e:Entity {id: $id}) SET e.type = $type, e.name = $name, e.aliases = $aliases, "
            "e.source_ids = $source_ids, e.permissions = $permissions",
            id=entity.id, type=entity.type, name=entity.name, aliases=entity.aliases,
            source_ids=entity.source_ids, permissions=entity.permissions,
        )
        return entity.id

    def upsert_relation(self, relation: Relation) -> None:
        if not relation.source_ids:
            raise KnowledgeGraphError("relation without provenance (source_ids)")
        self._run(
            "MATCH (a:Entity {id: $source}), (b:Entity {id: $target}) "
            "MERGE (a)-[r:REL {type: $type}]->(b) "
            "SET r.source_ids = $source_ids, r.confidence = $confidence, r.permissions = $permissions",
            source=relation.source, target=relation.target, type=relation.type,
            source_ids=list(relation.source_ids), confidence=relation.confidence,
            permissions=list(relation.permissions),
        )

    def get_entity(self, entity_id: str, principals: set[str] | None = None) -> Entity | None:
        rows = self._run(
            f"MATCH (e:Entity {{id: $id}}) WHERE {ACL_CLAUSE.format(var='e')} RETURN e",
            id=entity_id, principals=sorted(principals or []),
        )
        return _entity(rows[0]["e"]) if rows else None

    def entities(self, principals: set[str] | None = None) -> list[Entity]:
        rows = self._run(
            f"MATCH (e:Entity) WHERE {ACL_CLAUSE.format(var='e')} RETURN e", principals=sorted(principals or [])
        )
        return [_entity(row["e"]) for row in rows]

    def neighbors(self, entity_id: str, principals: set[str] | None = None) -> list[Relation]:
        rows = self._run(
            "MATCH (e:Entity {id: $id})-[r:REL]-(o:Entity) "
            f"WHERE {ACL_CLAUSE.format(var='r')} AND {ACL_CLAUSE.format(var='o')} "
            "RETURN startNode(r).id AS source, endNode(r).id AS target, r",
            id=entity_id, principals=sorted(principals or []),
        )
        return [
            Relation(
                source=row["source"], target=row["target"], type=row["r"]["type"],
                source_ids=tuple(row["r"].get("source_ids") or []),
                confidence=float(row["r"].get("confidence", 1.0)),
                permissions=tuple(row["r"].get("permissions") or []),
            )
            for row in rows
        ]

    def _run(self, query: str, **params: Any) -> list[Any]:
        with self.driver.session(database=self.database) as session:
            return list(session.run(query, **params))


class KuzuGraphStore:
    """Kuzu embedded adapter skeleton (requires: pip install kuzu).

    Kuzu is schema-first: create node/rel tables from graph_schema.yaml with
    ``CREATE NODE TABLE Entity(id STRING, type STRING, name STRING, aliases STRING[],
    source_ids STRING[], permissions STRING[], PRIMARY KEY(id))`` and
    ``CREATE REL TABLE REL(FROM Entity TO Entity, type STRING, source_ids STRING[],
    confidence DOUBLE, permissions STRING[])``; then mirror the Cypher of
    Neo4jGraphStore (Kuzu speaks Cypher) with ``connection.execute``.
    """

    def __init__(self, database_path: str) -> None:
        import kuzu  # noqa: PLC0415 - optional dependency of generated projects

        self.connection = kuzu.Connection(kuzu.Database(database_path))
