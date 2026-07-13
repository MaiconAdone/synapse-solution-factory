import hashlib
import json
import math
import re
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.repositories.enterprise_spec import load_enterprise_spec


TOKEN_RE = re.compile(r"[a-z0-9_]+", re.IGNORECASE)


class RagPipelineError(ValueError):
    pass


class RagPipeline:
    def __init__(self, root: Path | None = None) -> None:
        self.root = root or Path(__file__).resolve().parents[3]
        self.index_dir = self.root / "artifacts" / "rag" / "indexes"

    def plan(self) -> dict[str, object]:
        spec = load_enterprise_spec()
        vector_spec = spec["vector_databases"]
        return {
            "ingestion": ["load", "normalize", "pii_scan", "chunk", "embed", "index"],
            "chunking": vector_spec["default_chunking"],
            "metadata_schema": [
                "source_id",
                "document_id",
                "parent_id",
                "created_at",
                "permissions",
                "content_type",
                "project",
            ],
            "retrieval": spec["rag_advanced"]["strategies"],
            "compatible_vector_databases": vector_spec["compatible_targets"],
            "context_engineering": [
                "query_rewrite",
                "context_compression",
                "relevance_filtering",
                "citation_packaging",
            ],
            "evaluation": ["recall_at_k", "faithfulness", "answer_relevance", "latency_ms", "cost_per_answer"],
        }

    def build_index(
        self,
        documents: list[dict[str, Any]],
        *,
        index_name: str = "default",
        chunk_size: int = 160,
        chunk_overlap: int = 30,
    ) -> dict[str, Any]:
        if not documents:
            raise RagPipelineError("At least one document is required")
        if chunk_overlap >= chunk_size:
            raise RagPipelineError("chunk_overlap must be smaller than chunk_size")

        chunks: list[dict[str, Any]] = []
        for document in documents:
            text = str(document.get("text", "")).strip()
            if not text:
                continue
            source_id = str(document.get("source_id") or document.get("id") or self._stable_id(text))
            metadata = dict(document.get("metadata") or {})
            tokens = self._tokens(text)
            if not tokens:
                continue
            starts = range(0, len(tokens), max(1, chunk_size - chunk_overlap))
            for chunk_index, start in enumerate(starts):
                token_slice = tokens[start:start + chunk_size]
                if not token_slice:
                    continue
                chunk_text = " ".join(token_slice)
                chunk_id = self._stable_id(f"{source_id}:{chunk_index}:{chunk_text}")
                chunks.append(
                    {
                        "id": chunk_id,
                        "source_id": source_id,
                        "document_id": source_id,
                        "chunk_index": chunk_index,
                        "text": chunk_text,
                        "metadata": metadata,
                        "term_counts": dict(Counter(token_slice)),
                    }
                )

        if not chunks:
            raise RagPipelineError("No indexable text found")

        document_frequency: Counter[str] = Counter()
        for chunk in chunks:
            document_frequency.update(set(chunk["term_counts"].keys()))

        index = {
            "schema": "synapse-local-rag-index.v1",
            "index_name": index_name,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "chunk_size": chunk_size,
            "chunk_overlap": chunk_overlap,
            "document_count": len(documents),
            "chunk_count": len(chunks),
            "document_frequency": dict(document_frequency),
            "chunks": chunks,
        }
        path = self._index_path(index_name)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(index, indent=2, ensure_ascii=False), encoding="utf-8")
        return {
            "index_name": index_name,
            "index_path": str(path.relative_to(self.root)),
            "document_count": len(documents),
            "chunk_count": len(chunks),
            "ready": True,
        }

    def query(self, query: str, *, index_name: str = "default", top_k: int = 4) -> dict[str, Any]:
        if not query.strip():
            raise RagPipelineError("query is required")
        index = self._load_index(index_name)
        query_tokens = self._tokens(query)
        if not query_tokens:
            raise RagPipelineError("query has no searchable terms")

        scored = [
            (self._score_chunk(query_tokens, chunk, index), chunk)
            for chunk in index["chunks"]
        ]
        ranked = [
            (score, chunk)
            for score, chunk in sorted(scored, key=lambda item: item[0], reverse=True)
            if score > 0
        ][:top_k]
        citations = [
            {
                "source_id": chunk["source_id"],
                "document_id": chunk["document_id"],
                "chunk_id": chunk["id"],
                "chunk_index": chunk["chunk_index"],
                "score": round(score, 6),
                "text": chunk["text"],
                "metadata": chunk.get("metadata", {}),
            }
            for score, chunk in ranked
        ]
        answer = self._extractive_answer(query_tokens, citations)
        return {
            "index_name": index_name,
            "query": query,
            "answer": answer,
            "citations": citations,
            "metrics": {
                "retrieved_chunks": len(citations),
                "citation_coverage": 1.0 if citations else 0.0,
                "local_only": True,
            },
        }

    def _score_chunk(self, query_tokens: list[str], chunk: dict[str, Any], index: dict[str, Any]) -> float:
        total_chunks = max(1, int(index["chunk_count"]))
        term_counts = chunk["term_counts"]
        chunk_length = max(1, sum(term_counts.values()))
        score = 0.0
        for token in query_tokens:
            tf = float(term_counts.get(token, 0)) / chunk_length
            if tf == 0:
                continue
            df = float(index["document_frequency"].get(token, 0))
            idf = math.log((1 + total_chunks) / (1 + df)) + 1
            score += tf * idf
        query_set = set(query_tokens)
        chunk_set = set(term_counts)
        overlap = len(query_set & chunk_set) / max(1, len(query_set))
        return score + overlap

    def _extractive_answer(self, query_tokens: list[str], citations: list[dict[str, Any]]) -> str:
        if not citations:
            return "Nao encontrei evidencia suficiente no indice local para responder com citacoes."
        best = citations[0]["text"]
        sentences = re.split(r"(?<=[.!?])\s+", best)
        query_set = set(query_tokens)
        best_sentence = max(
            sentences,
            key=lambda sentence: len(query_set & set(self._tokens(sentence))),
            default=best,
        )
        return best_sentence.strip() or best

    def _load_index(self, index_name: str) -> dict[str, Any]:
        path = self._index_path(index_name)
        if not path.exists():
            raise RagPipelineError(f"RAG index not found: {index_name}")
        return json.loads(path.read_text(encoding="utf-8"))

    def _index_path(self, index_name: str) -> Path:
        safe_name = re.sub(r"[^a-zA-Z0-9_.-]+", "-", index_name).strip("-") or "default"
        return self.index_dir / f"{safe_name}.json"

    @staticmethod
    def _tokens(text: str) -> list[str]:
        return [token.lower() for token in TOKEN_RE.findall(text)]

    @staticmethod
    def _stable_id(text: str) -> str:
        return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]
