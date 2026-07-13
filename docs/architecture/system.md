# System Architecture

## Control Plane

Codex is the engineering operator. Ruflo provides MCP-backed swarm state,
coordination, durable memory, and semantic retrieval.

The machine-readable runtime contract lives in `config/runtime_manifest.json`.
Backend services read this manifest so API responses, validation scripts, and
operator documentation share the same source of truth.

## Backend

FastAPI exposes operational APIs for health, agents, workflows, memory, and
swarm status. The backend is organized around:

- `routes/` for API boundaries
- `services/` for business logic
- `repositories/` for persistence adapters
- `models/` for ORM entities
- `schemas/` for request/response contracts
- `agents/` for agent catalogs and runtime adapters
- `rag/` for retrieval pipelines
- `orchestration/` for workflow definitions

## Frontend

Next.js provides a decoupled enterprise dashboard with screens for agents,
workflows, memory, and swarm monitoring.
