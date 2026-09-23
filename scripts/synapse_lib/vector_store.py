"""Vector storage contract and a dependency-free local implementation.

Production vector databases (pgvector, Qdrant, Weaviate, Milvus, Pinecone...)
plug in by implementing ``VectorStore``; see templates/rag/vector_db_adapter.py.
``InMemoryVectorStore`` and ``HashingEmbedder`` exist for bootstrap, offline
retrieval evals and contract tests, following config/rag_scalability_policy.json.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from typing import Any, Iterable, Protocol

import numpy as np

from scripts.synapse_lib.text_utils import normalize_text, tokenize  # noqa: F401 - re-exported


class VectorStoreError(ValueError):
    pass


@dataclass(frozen=True)
class VectorRecord:
    id: str
    vector: np.ndarray
    text: str
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class SearchHit:
    id: str
    score: float
    text: str
    metadata: dict[str, Any]


class Embedder(Protocol):
    model_id: str
    dimension: int

    def embed(self, texts: list[str]) -> np.ndarray: ...


class VectorStore(Protocol):
    """Adapter contract every vector database integration must honor."""

    embedding_model: str
    dimension: int
    index_version: str

    def upsert(self, records: Iterable[VectorRecord]) -> int: ...

    def delete(self, ids: Iterable[str]) -> int: ...

    def query(
        self,
        vector: np.ndarray,
        k: int,
        filters: dict[str, Any] | None = None,
        principals: set[str] | None = None,
    ) -> list[SearchHit]: ...

    def count(self) -> int: ...


def matches_filters(metadata: dict[str, Any], filters: dict[str, Any] | None) -> bool:
    """Equality filter; a list value means "metadata value is one of these"."""
    for key, expected in (filters or {}).items():
        actual = metadata.get(key)
        if isinstance(expected, (list, tuple, set)):
            if actual not in expected:
                return False
        elif actual != expected:
            return False
    return True


def is_allowed(metadata: dict[str, Any], principals: set[str] | None) -> bool:
    """ACL check enforced in the retrieval layer, never delegated to the prompt.

    A chunk without ``permissions`` is public. When permissions exist, the
    caller must share at least one principal with them; no principals means
    only public chunks are visible.
    """
    permissions = metadata.get("permissions")
    if not permissions:
        return True
    return bool(set(permissions) & (principals or set()))


class HashingEmbedder:
    """Deterministic local embedder (signed feature hashing of words and char trigrams).

    It captures lexical similarity only. Use it for tests and offline bootstrap;
    swap for a semantic embedding model behind the same interface in production.
    """

    def __init__(self, dimension: int = 384) -> None:
        if dimension <= 0:
            raise VectorStoreError("dimension must be positive")
        self.dimension = dimension
        self.model_id = f"synapse-hashing-v1-{dimension}"

    def embed(self, texts: list[str]) -> np.ndarray:
        matrix = np.zeros((len(texts), self.dimension), dtype=np.float32)
        for row, text in enumerate(texts):
            for feature, weight in self._features(text):
                digest = hashlib.blake2b(feature.encode("utf-8"), digest_size=8).digest()
                value = int.from_bytes(digest, "little")
                index = value % self.dimension
                sign = 1.0 if (value >> 63) & 1 else -1.0
                matrix[row, index] += sign * weight
        norms = np.linalg.norm(matrix, axis=1, keepdims=True)
        norms[norms == 0] = 1.0
        return matrix / norms

    def _features(self, text: str) -> list[tuple[str, float]]:
        features: list[tuple[str, float]] = []
        for token in tokenize(text):
            features.append((f"w:{token}", 1.0))
            padded = f"#{token}#"
            features.extend((f"c:{padded[i:i + 3]}", 0.5) for i in range(len(padded) - 2))
        return features


class InMemoryVectorStore:
    """Exact cosine search with metadata pre-filtering and ACL enforcement."""

    def __init__(self, embedding_model: str, dimension: int, index_version: str = "v1") -> None:
        self.embedding_model = embedding_model
        self.dimension = dimension
        self.index_version = index_version
        self._ids: list[str] = []
        self._positions: dict[str, int] = {}
        self._rows: list[np.ndarray] = []
        self._matrix: np.ndarray | None = None
        self._texts: list[str] = []
        self._metadata: list[dict[str, Any]] = []

    def upsert(self, records: Iterable[VectorRecord]) -> int:
        written = 0
        for record in records:
            vector = np.asarray(record.vector, dtype=np.float32).reshape(-1)
            if vector.shape[0] != self.dimension:
                raise VectorStoreError(
                    f"vector dimension {vector.shape[0]} does not match index dimension {self.dimension}"
                )
            record_model = record.metadata.get("embedding_model", self.embedding_model)
            if record_model != self.embedding_model:
                raise VectorStoreError(
                    f"refusing to mix embedding models in one index: {record_model} != {self.embedding_model}"
                )
            metadata = {**record.metadata, "embedding_model": self.embedding_model, "index_version": self.index_version}
            norm = float(np.linalg.norm(vector))
            vector = vector / norm if norm else vector
            if record.id in self._positions:
                position = self._positions[record.id]
                self._rows[position] = vector
                self._texts[position] = record.text
                self._metadata[position] = metadata
            else:
                self._positions[record.id] = len(self._ids)
                self._ids.append(record.id)
                self._rows.append(vector)
                self._texts.append(record.text)
                self._metadata.append(metadata)
            written += 1
        self._matrix = None
        return written

    def delete(self, ids: Iterable[str]) -> int:
        doomed = {item for item in ids if item in self._positions}
        if not doomed:
            return 0
        keep = [index for index, item in enumerate(self._ids) if item not in doomed]
        self._ids = [self._ids[index] for index in keep]
        self._texts = [self._texts[index] for index in keep]
        self._metadata = [self._metadata[index] for index in keep]
        self._rows = [self._rows[index] for index in keep]
        self._matrix = None
        self._positions = {item: index for index, item in enumerate(self._ids)}
        return len(doomed)

    def query(
        self,
        vector: np.ndarray,
        k: int,
        filters: dict[str, Any] | None = None,
        principals: set[str] | None = None,
    ) -> list[SearchHit]:
        if k <= 0 or not self._ids:
            return []
        candidates = [
            index
            for index, metadata in enumerate(self._metadata)
            if matches_filters(metadata, filters) and is_allowed(metadata, principals)
        ]
        if not candidates:
            return []
        query = np.asarray(vector, dtype=np.float32).reshape(-1)
        norm = float(np.linalg.norm(query))
        query = query / norm if norm else query
        scores = self._vector_matrix()[candidates] @ query
        order = np.argsort(-scores, kind="stable")[:k]
        return [
            SearchHit(
                id=self._ids[candidates[position]],
                score=float(scores[position]),
                text=self._texts[candidates[position]],
                metadata=dict(self._metadata[candidates[position]]),
            )
            for position in order
        ]

    def count(self) -> int:
        return len(self._ids)

    def _vector_matrix(self) -> np.ndarray:
        if self._matrix is None:
            self._matrix = np.vstack(self._rows) if self._rows else np.zeros((0, self.dimension), dtype=np.float32)
        return self._matrix

    def get(self, record_id: str) -> SearchHit | None:
        position = self._positions.get(record_id)
        if position is None:
            return None
        return SearchHit(record_id, 1.0, self._texts[position], dict(self._metadata[position]))

    def content_hashes(self) -> dict[str, str]:
        return {
            item: str(self._metadata[index].get("content_hash", ""))
            for index, item in enumerate(self._ids)
        }
