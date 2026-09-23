"""Production vector store adapter skeletons implementing the VectorStore
protocol from scripts/synapse_lib/vector_store.py.

Pick the adapter chosen by RagScalabilityPlanner, install its client in the
generated project only (not in Synapse), and run `python scripts/run_evals.py
retrieval` against it before switching the serving alias.

Rules enforced by every adapter (config/rag_scalability_policy.json):
- one embedding model per index/collection (name carries model + version);
- metadata/ACL filters are applied inside the database query, before ranking;
- ids are stable chunk ids so re-ingestion is an idempotent upsert.
"""

from __future__ import annotations

import json
import uuid
from typing import Any, Iterable

import numpy as np

from scripts.synapse_lib.vector_store import SearchHit, VectorRecord, VectorStoreError

CHUNK_NAMESPACE = uuid.UUID("6f1c3a52-1e7b-4d1a-9a55-5e0c2f3b9d10")


def index_name(collection: str, embedding_model: str, version: int) -> str:
    safe_model = embedding_model.replace("/", "-").replace(":", "-")
    return f"{collection}__{safe_model}__v{version}"


class PgVectorStore:
    """pgvector adapter (requires: pip install "psycopg[binary]" pgvector).

    Schema created by ``ensure_schema``:
        CREATE EXTENSION IF NOT EXISTS vector;
        CREATE TABLE <table> (id text PRIMARY KEY, embedding vector(<dim>),
                              text text, metadata jsonb);
        CREATE INDEX ON <table> USING hnsw (embedding vector_cosine_ops)
            WITH (m = 16, ef_construction = 200);
    ACL: rows with metadata.permissions are returned only when they share a
    principal with the caller.
    """

    def __init__(self, dsn: str, collection: str, embedding_model: str, dimension: int, version: int = 1) -> None:
        import psycopg  # noqa: PLC0415 - optional dependency of generated projects
        from pgvector.psycopg import register_vector  # noqa: PLC0415

        self.embedding_model = embedding_model
        self.dimension = dimension
        self.index_version = f"v{version}"
        self.table = index_name(collection, embedding_model, version).replace("-", "_").replace(".", "_")
        self.connection = psycopg.connect(dsn, autocommit=True)
        self.connection.execute("CREATE EXTENSION IF NOT EXISTS vector")
        register_vector(self.connection)

    def ensure_schema(self, m: int = 16, ef_construction: int = 200) -> None:
        self.connection.execute(
            f"CREATE TABLE IF NOT EXISTS {self.table} "
            f"(id text PRIMARY KEY, embedding vector({self.dimension}), text text, metadata jsonb)"
        )
        self.connection.execute(
            f"CREATE INDEX IF NOT EXISTS {self.table}_hnsw ON {self.table} "
            f"USING hnsw (embedding vector_cosine_ops) WITH (m = {int(m)}, ef_construction = {int(ef_construction)})"
        )

    def upsert(self, records: Iterable[VectorRecord]) -> int:
        written = 0
        with self.connection.cursor() as cursor:
            for record in records:
                self._check(record)
                cursor.execute(
                    f"INSERT INTO {self.table} (id, embedding, text, metadata) VALUES (%s, %s, %s, %s) "
                    "ON CONFLICT (id) DO UPDATE SET embedding = EXCLUDED.embedding, "
                    "text = EXCLUDED.text, metadata = EXCLUDED.metadata",
                    (record.id, np.asarray(record.vector, dtype=np.float32), record.text, json.dumps(self._metadata(record))),
                )
                written += 1
        return written

    def delete(self, ids: Iterable[str]) -> int:
        doomed = list(ids)
        if not doomed:
            return 0
        cursor = self.connection.execute(f"DELETE FROM {self.table} WHERE id = ANY(%s)", (doomed,))
        return cursor.rowcount

    def query(self, vector: np.ndarray, k: int, filters: dict[str, Any] | None = None, principals: set[str] | None = None) -> list[SearchHit]:
        clauses, params = ["metadata @> %s::jsonb"], [json.dumps(filters or {})]
        clauses.append(
            "(NOT metadata ? 'permissions' OR jsonb_array_length(metadata->'permissions') = 0 "
            "OR metadata->'permissions' ?| %s)"
        )
        params.append(sorted(principals or []))
        query_vector = np.asarray(vector, dtype=np.float32)
        rows = self.connection.execute(
            f"SELECT id, text, metadata, 1 - (embedding <=> %s) AS score FROM {self.table} "
            f"WHERE {' AND '.join(clauses)} ORDER BY embedding <=> %s LIMIT %s",
            (query_vector, *params, query_vector, int(k)),
        ).fetchall()
        return [SearchHit(row[0], float(row[3]), row[1], row[2]) for row in rows]

    def count(self) -> int:
        return int(self.connection.execute(f"SELECT count(*) FROM {self.table}").fetchone()[0])

    def _check(self, record: VectorRecord) -> None:
        if len(record.vector) != self.dimension:
            raise VectorStoreError("dimension mismatch")
        if record.metadata.get("embedding_model", self.embedding_model) != self.embedding_model:
            raise VectorStoreError("refusing to mix embedding models in one index")

    def _metadata(self, record: VectorRecord) -> dict[str, Any]:
        return {**record.metadata, "embedding_model": self.embedding_model, "index_version": self.index_version}


class QdrantVectorStore:
    """Qdrant adapter (requires: pip install qdrant-client).

    Qdrant point ids must be integers or UUIDs, so chunk ids are mapped with
    uuid5 and the original id is kept in the payload. Equality filters become
    ``must`` conditions; ACL uses a ``should`` over permissions plus an
    ``is_public`` flag written at upsert time.
    """

    def __init__(self, url: str, collection: str, embedding_model: str, dimension: int, version: int = 1, api_key: str | None = None) -> None:
        from qdrant_client import QdrantClient  # noqa: PLC0415 - optional dependency of generated projects

        self.embedding_model = embedding_model
        self.dimension = dimension
        self.index_version = f"v{version}"
        self.collection = index_name(collection, embedding_model, version)
        self.client = QdrantClient(url=url, api_key=api_key)

    def ensure_collection(self, m: int = 16, ef_construction: int = 200) -> None:
        from qdrant_client import models  # noqa: PLC0415

        if not self.client.collection_exists(self.collection):
            self.client.create_collection(
                collection_name=self.collection,
                vectors_config=models.VectorParams(size=self.dimension, distance=models.Distance.COSINE),
                hnsw_config=models.HnswConfigDiff(m=m, ef_construct=ef_construction),
            )

    def upsert(self, records: Iterable[VectorRecord]) -> int:
        from qdrant_client import models  # noqa: PLC0415

        points = []
        for record in records:
            if len(record.vector) != self.dimension:
                raise VectorStoreError("dimension mismatch")
            if record.metadata.get("embedding_model", self.embedding_model) != self.embedding_model:
                raise VectorStoreError("refusing to mix embedding models in one index")
            payload = {
                **record.metadata,
                "chunk_id": record.id,
                "text": record.text,
                "embedding_model": self.embedding_model,
                "index_version": self.index_version,
                "is_public": not record.metadata.get("permissions"),
            }
            points.append(models.PointStruct(id=str(uuid.uuid5(CHUNK_NAMESPACE, record.id)), vector=list(map(float, record.vector)), payload=payload))
        if points:
            self.client.upsert(collection_name=self.collection, points=points)
        return len(points)

    def delete(self, ids: Iterable[str]) -> int:
        from qdrant_client import models  # noqa: PLC0415

        point_ids = [str(uuid.uuid5(CHUNK_NAMESPACE, item)) for item in ids]
        if point_ids:
            self.client.delete(collection_name=self.collection, points_selector=models.PointIdsList(points=point_ids))
        return len(point_ids)

    def query(self, vector: np.ndarray, k: int, filters: dict[str, Any] | None = None, principals: set[str] | None = None) -> list[SearchHit]:
        from qdrant_client import models  # noqa: PLC0415

        must = [
            models.FieldCondition(key=key, match=models.MatchAny(any=list(value)) if isinstance(value, (list, set, tuple)) else models.MatchValue(value=value))
            for key, value in (filters or {}).items()
        ]
        should = [models.FieldCondition(key="is_public", match=models.MatchValue(value=True))]
        if principals:
            should.append(models.FieldCondition(key="permissions", match=models.MatchAny(any=sorted(principals))))
        must.append(models.Filter(should=should))
        response = self.client.query_points(
            collection_name=self.collection,
            query=list(map(float, vector)),
            limit=int(k),
            query_filter=models.Filter(must=must),
            with_payload=True,
        )
        return [
            SearchHit(point.payload["chunk_id"], float(point.score), point.payload.get("text", ""), dict(point.payload))
            for point in response.points
        ]

    def count(self) -> int:
        return int(self.client.count(collection_name=self.collection, exact=True).count)
