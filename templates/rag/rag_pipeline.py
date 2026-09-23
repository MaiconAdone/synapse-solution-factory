"""Local end-to-end RAG pipeline template (ingest -> chunk -> embed -> index ->
hybrid retrieve -> cited context), following config/rag_scalability_policy.json.

Run from the project root:

    python templates/rag/rag_pipeline.py --query "how are indexes versioned?"

Swap HashingEmbedder/InMemoryVectorStore for a semantic embedder and a
production store (see vector_db_adapter.py) without changing the pipeline.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from scripts.synapse_lib.rag_retrieval import HybridRetriever, index_files  # noqa: E402


def load_policy() -> dict:
    return json.loads((ROOT / "config" / "rag_scalability_policy.json").read_text(encoding="utf-8-sig"))


def corpus_paths(globs: list[str]) -> list[str]:
    return sorted({path.relative_to(ROOT).as_posix() for pattern in globs for path in ROOT.glob(pattern) if path.is_file()})


def build_retriever(policy: dict) -> HybridRetriever:
    retrieval = policy["retrieval"]
    chunking = policy["chunking"]
    retriever = HybridRetriever(
        rrf_k=retrieval["rrf_k"],
        dense_candidates=retrieval["dense_candidates"],
        lexical_candidates=retrieval["lexical_candidates"],
        low_confidence_below=retrieval["rerank_only_when_confidence_below"],
    )
    index_files(
        retriever,
        ROOT,
        corpus_paths(policy["evaluation"]["bootstrap_corpus_globs"]),
        chunking["chunk_size_tokens"],
        chunking["chunk_overlap_tokens"],
    )
    return retriever


def answer_context(retriever: HybridRetriever, query: str, top_k: int, principals: set[str] | None = None) -> dict:
    result = retriever.retrieve(query, k=top_k, principals=principals)
    return {
        "query": query,
        "index_version": result.index_version,
        "low_confidence": result.low_confidence,
        "next_action": "rerank_or_ask_user" if result.low_confidence else "answer_with_citations",
        "citations": result.sources(),
        "context": [
            {"source": chunk.metadata["source_id"], "chunk": chunk.metadata["chunk_index"], "text": chunk.text[:600]}
            for chunk in result.chunks
        ],
        "diagnostics": result.diagnostics,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the local Synapse RAG pipeline template.")
    parser.add_argument("--query", required=True)
    parser.add_argument("--top-k", type=int, default=0)
    args = parser.parse_args()
    policy = load_policy()
    retriever = build_retriever(policy)
    top_k = args.top_k or policy["retrieval"]["final_top_k"]
    print(json.dumps(answer_context(retriever, args.query, top_k), indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
