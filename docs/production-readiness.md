# Production Readiness

This checklist tracks the local production hardening already prepared for the
SYNAPSE AI stack and the items that still require an external runtime decision.

## Implemented Locally

- Backend API exposed through FastAPI routes for health, agents, workflows,
  memory, swarm, and runtime manifest.
- Frontend pages fetch live backend data with local fallback catalogs when the
  API is unavailable.
- Shared frontend shell keeps navigation available across dashboard, agents,
  workflows, memory, and swarm screens.
- Environment templates are available at `.env.example`, `backend/.env.example`,
  and `frontend/.env.example`.
- Dockerfiles are available for backend and frontend.
- `docker-compose.yml` runs both services locally with a backend healthcheck.
- GitHub Actions CI validates the enterprise stack, runs backend tests, and
  builds the frontend.
- Backend contract tests cover required agents, memory, swarm, workflows,
  runtime manifest, and Ruflo adapter behavior.
- Ruflo agent activation runs in parallel by default during project activation,
  with sequential activation available only as a debug option.

## Local Commands

```powershell
.\scripts\validate_enterprise_stack.ps1
```

```powershell
$env:PYTHONPATH = "backend"
python -m pytest tests
```

```powershell
docker compose up --build
```

```powershell
cd frontend
npm run build
```

## Runtime Configuration

- `API_BASE_URL` controls server-side frontend calls to the backend.
- `NEXT_PUBLIC_API_BASE_URL` is available for browser-side calls if interactive
  client components are added later.
- `ENVIRONMENT`, `RUFLO_MCP_SERVER`, `SWARM_TOPOLOGY`, `SWARM_CONSENSUS`,
  `MEMORY_BACKEND`, and `VECTOR_DB_PATH` configure the backend.

## External Decisions Still Required

- Production secret store, such as GitHub Actions secrets, cloud secret manager,
  or a managed platform environment.
- Deployment target, such as container platform, VM, PaaS, or Kubernetes.
- Managed observability sink for logs, metrics, traces, and alerts.
- Real Ruflo MCP availability in the target environment.
- Authentication and authorization provider.
- Persistent database choice if runtime state grows beyond manifest and file
  backed artifacts.

## Recommended Next Gates

- Add authenticated API boundaries before exposing operational endpoints.
- Add Playwright or equivalent E2E checks for the dashboard flows.
- Add deployment-specific smoke tests for `/health`, `/agents/runtime`,
  `/memory/stats`, and `/swarm/status`.
- Connect LLM/RAG metrics to the observability plan in `llm_ops/observability.yaml`.
- Define rollback and incident runbooks per workflow before first production
  release.
