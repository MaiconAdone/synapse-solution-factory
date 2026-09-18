# RAG Pipelines

This directory contains executable design contracts for retrieval-augmented
generation.

SYNAPSE itself has no application runtime, so this pipeline is a specification
rather than an executable service. It defines chunking, local indexing,
retrieval, simple reranking and citation packaging without calling a cloud
model; a generated project implements this pattern in its own stack when the
universe requires RAG. Production vector stores, external rerankers and
advanced GraphRAG remain adapter-driven extensions.

## Required Artifacts

- `pipeline.yaml`
- `retrieval_eval.md`
