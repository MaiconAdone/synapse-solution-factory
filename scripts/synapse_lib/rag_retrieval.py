"""Hybrid retrieval reference: structure-aware chunking, BM25, dense search,
reciprocal rank fusion, ACL-safe filtering and retrieval metrics.

Behavior follows config/rag_scalability_policy.json (chunking, retrieval,
index_lifecycle). Everything here is deterministic so retrieval quality can be
gated in tests before any cloud model is involved.
"""

from __future__ import annotations

import hashlib
import math
import re
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable

from scripts.synapse_lib.vector_store import (
    Embedder,
    HashingEmbedder,
    InMemoryVectorStore,
    VectorRecord,
    VectorStore,
    is_allowed,
    matches_filters,
    tokenize,
)


@dataclass(frozen=True)
class Chunk:
    id: str
    text: str
    metadata: dict[str, Any]


@dataclass
class RetrievedChunk:
    id: str
    text: str
    metadata: dict[str, Any]
    fused_score: float
    dense_rank: int | None = None
    lexical_rank: int | None = None
    dense_score: float | None = None


@dataclass
class RetrievalResult:
    query: str
    chunks: list[RetrievedChunk]
    index_version: str
    low_confidence: bool
    diagnostics: dict[str, Any] = field(default_factory=dict)

    def sources(self) -> list[str]:
        return list(dict.fromkeys(chunk.metadata.get("source_id", "") for chunk in self.chunks))


def content_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def chunk_text(
    text: str,
    source_id: str,
    chunk_size_tokens: int = 800,
    chunk_overlap_tokens: int = 120,
    metadata: dict[str, Any] | None = None,
) -> list[Chunk]:
    """Split on paragraph/heading boundaries, pack to ~chunk_size words, keep overlap.

    Word count approximates tokens; the id is stable for identical content so
    incremental ingestion can skip unchanged chunks.
    """
    if chunk_size_tokens <= 0 or chunk_overlap_tokens < 0 or chunk_overlap_tokens >= chunk_size_tokens:
        raise ValueError("require chunk_size_tokens > chunk_overlap_tokens >= 0")
    blocks = [block.strip() for block in re.split(r"\n\s*\n|\n(?=#)", text) if block.strip()]
    words_per_block = [block.split() for block in blocks]

    packed: list[list[str]] = []
    current: list[str] = []
    for words in words_per_block:
        while len(words) > chunk_size_tokens:
            if current:
                packed.append(current)
                current = []
            packed.append(words[:chunk_size_tokens])
            words = words[chunk_size_tokens - chunk_overlap_tokens:]
        if current and len(current) + len(words) > chunk_size_tokens:
            packed.append(current)
            current = current[-chunk_overlap_tokens:] if chunk_overlap_tokens else []
        current = current + words
    if current:
        packed.append(current)

    base = dict(metadata or {})
    chunks = []
    for index, words in enumerate(packed):
        body = " ".join(words)
        digest = content_hash(body)
        chunk_id = hashlib.sha1(f"{source_id}|{index}|{digest}".encode("utf-8")).hexdigest()[:16]
        chunks.append(
            Chunk(
                id=chunk_id,
                text=body,
                metadata={
                    **base,
                    "source_id": source_id,
                    "document_id": base.get("document_id", source_id),
                    "chunk_index": index,
                    "content_hash": digest,
                },
            )
        )
    return chunks


class BM25Index:
    """Okapi BM25 lexical index (k1=1.5, b=0.75)."""

    def __init__(self, k1: float = 1.5, b: float = 0.75) -> None:
        self.k1 = k1
        self.b = b
        self._docs: dict[str, Counter[str]] = {}
        self._lengths: dict[str, int] = {}
        self._metadata: dict[str, dict[str, Any]] = {}
        self._df: Counter[str] = Counter()

    def add(self, doc_id: str, text: str, metadata: dict[str, Any] | None = None) -> None:
        self.remove(doc_id)
        terms = Counter(tokenize(text))
        self._docs[doc_id] = terms
        self._lengths[doc_id] = sum(terms.values())
        self._metadata[doc_id] = dict(metadata or {})
        self._df.update(terms.keys())

    def remove(self, doc_id: str) -> None:
        terms = self._docs.pop(doc_id, None)
        if terms is None:
            return
        self._df.subtract(terms.keys())
        self._lengths.pop(doc_id, None)
        self._metadata.pop(doc_id, None)

    def search(
        self,
        query: str,
        k: int,
        filters: dict[str, Any] | None = None,
        principals: set[str] | None = None,
    ) -> list[tuple[str, float]]:
        if not self._docs or k <= 0:
            return []
        total = len(self._docs)
        average_length = sum(self._lengths.values()) / total
        query_terms = set(tokenize(query))
        scores: list[tuple[str, float]] = []
        for doc_id, terms in self._docs.items():
            metadata = self._metadata[doc_id]
            if not matches_filters(metadata, filters) or not is_allowed(metadata, principals):
                continue
            score = 0.0
            for term in query_terms:
                frequency = terms.get(term, 0)
                if not frequency:
                    continue
                df = self._df[term]
                idf = math.log(1 + (total - df + 0.5) / (df + 0.5))
                norm = frequency + self.k1 * (1 - self.b + self.b * self._lengths[doc_id] / average_length)
                score += idf * frequency * (self.k1 + 1) / norm
            if score > 0:
                scores.append((doc_id, score))
        scores.sort(key=lambda item: (-item[1], item[0]))
        return scores[:k]


def reciprocal_rank_fusion(rankings: Iterable[list[str]], k: int = 60) -> list[tuple[str, float]]:
    """Fuse ranked id lists: score(d) = sum 1 / (k + rank). Rank starts at 1."""
    fused: dict[str, float] = {}
    for ranking in rankings:
        for rank, doc_id in enumerate(ranking, start=1):
            fused[doc_id] = fused.get(doc_id, 0.0) + 1.0 / (k + rank)
    return sorted(fused.items(), key=lambda item: (-item[1], item[0]))


class HybridRetriever:
    """Dense + BM25 retrieval fused with RRF over a shared, ACL-filtered candidate set."""

    def __init__(
        self,
        embedder: Embedder | None = None,
        store: VectorStore | None = None,
        rrf_k: int = 60,
        dense_candidates: int = 50,
        lexical_candidates: int = 50,
        low_confidence_below: float = 0.72,
    ) -> None:
        self.embedder = embedder or HashingEmbedder()
        self.store = store or InMemoryVectorStore(self.embedder.model_id, self.embedder.dimension)
        if self.store.embedding_model != self.embedder.model_id:
            raise ValueError("store and embedder must use the same embedding model")
        self.lexical = BM25Index()
        self.rrf_k = rrf_k
        self.dense_candidates = dense_candidates
        self.lexical_candidates = lexical_candidates
        self.low_confidence_below = low_confidence_below
        self._chunks: dict[str, Chunk] = {}

    def index(self, chunks: Iterable[Chunk]) -> dict[str, int]:
        """Incremental ingestion: unchanged content_hash is skipped, changes are upserted."""
        pending = [
            chunk
            for chunk in chunks
            if self._chunks.get(chunk.id) is None
            or self._chunks[chunk.id].metadata.get("content_hash") != chunk.metadata.get("content_hash")
        ]
        if pending:
            vectors = self.embedder.embed([chunk.text for chunk in pending])
            self.store.upsert(
                VectorRecord(chunk.id, vector, chunk.text, {**chunk.metadata, "embedding_model": self.embedder.model_id})
                for chunk, vector in zip(pending, vectors)
            )
            for chunk in pending:
                self.lexical.add(chunk.id, chunk.text, chunk.metadata)
                self._chunks[chunk.id] = chunk
        return {"indexed": len(pending), "total": self.store.count()}

    def sync_source(self, source_id: str, chunks: list[Chunk]) -> dict[str, int]:
        """Make the index match the latest chunks of one source (stale chunks are tombstoned)."""
        current_ids = {chunk.id for chunk in chunks}
        stale = [
            chunk_id
            for chunk_id, chunk in self._chunks.items()
            if chunk.metadata.get("source_id") == source_id and chunk_id not in current_ids
        ]
        for chunk_id in stale:
            self.lexical.remove(chunk_id)
            self._chunks.pop(chunk_id, None)
        removed = self.store.delete(stale)
        return {**self.index(chunks), "removed": removed}

    def remove_source(self, source_id: str) -> int:
        doomed = [chunk_id for chunk_id, chunk in self._chunks.items() if chunk.metadata.get("source_id") == source_id]
        for chunk_id in doomed:
            self.lexical.remove(chunk_id)
            self._chunks.pop(chunk_id, None)
        return self.store.delete(doomed)

    def retrieve(
        self,
        query: str,
        k: int = 6,
        filters: dict[str, Any] | None = None,
        principals: set[str] | None = None,
    ) -> RetrievalResult:
        query_vector = self.embedder.embed([query])[0]
        dense_hits = self.store.query(query_vector, self.dense_candidates, filters, principals)
        lexical_hits = self.lexical.search(query, self.lexical_candidates, filters, principals)
        dense_ranking = [hit.id for hit in dense_hits]
        lexical_ranking = [doc_id for doc_id, _ in lexical_hits]
        fused = reciprocal_rank_fusion([dense_ranking, lexical_ranking], k=self.rrf_k)[:k]

        dense_positions = {doc_id: rank for rank, doc_id in enumerate(dense_ranking, start=1)}
        lexical_positions = {doc_id: rank for rank, doc_id in enumerate(lexical_ranking, start=1)}
        dense_scores = {hit.id: hit.score for hit in dense_hits}
        chunks = [
            RetrievedChunk(
                id=doc_id,
                text=self._chunks[doc_id].text,
                metadata=dict(self._chunks[doc_id].metadata),
                fused_score=score,
                dense_rank=dense_positions.get(doc_id),
                lexical_rank=lexical_positions.get(doc_id),
                dense_score=dense_scores.get(doc_id),
            )
            for doc_id, score in fused
            if doc_id in self._chunks
        ]
        top_dense = dense_hits[0].score if dense_hits else 0.0
        return RetrievalResult(
            query=query,
            chunks=chunks,
            index_version=self.store.index_version,
            low_confidence=top_dense < self.low_confidence_below,
            diagnostics={
                "dense_top_score": top_dense,
                "dense_candidates": len(dense_hits),
                "lexical_candidates": len(lexical_hits),
                "filters_applied": sorted((filters or {}).keys()),
                "embedding_model": self.embedder.model_id,
            },
        )


def index_files(
    retriever: HybridRetriever,
    root: Path,
    relative_paths: Iterable[str],
    chunk_size_tokens: int = 800,
    chunk_overlap_tokens: int = 120,
) -> dict[str, int]:
    totals = {"indexed": 0, "removed": 0, "sources": 0}
    for relative_path in relative_paths:
        path = root / relative_path
        if not path.is_file():
            continue
        source_id = relative_path.replace("\\", "/")
        text = path.read_text(encoding="utf-8-sig", errors="replace")
        outcome = retriever.sync_source(source_id, chunk_text(text, source_id, chunk_size_tokens, chunk_overlap_tokens))
        totals["indexed"] += outcome["indexed"]
        totals["removed"] += outcome["removed"]
        totals["sources"] += 1
    totals["total"] = retriever.store.count()
    return totals


def recall_at_k(retrieved: list[str], relevant: set[str], k: int) -> float:
    if not relevant:
        return 0.0
    return len(set(retrieved[:k]) & relevant) / len(relevant)


def mean_reciprocal_rank(retrieved: list[str], relevant: set[str]) -> float:
    for rank, item in enumerate(retrieved, start=1):
        if item in relevant:
            return 1.0 / rank
    return 0.0


def ndcg_at_k(retrieved: list[str], relevant: set[str], k: int) -> float:
    dcg = sum(1.0 / math.log2(rank + 1) for rank, item in enumerate(retrieved[:k], start=1) if item in relevant)
    ideal = sum(1.0 / math.log2(rank + 1) for rank in range(1, min(len(relevant), k) + 1))
    return dcg / ideal if ideal else 0.0
