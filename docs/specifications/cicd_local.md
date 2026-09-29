# Local CI/CD Specification

Applies to every universe. Source of truth: `config/cicd_policy.json`.
Implementation: `scripts/synapse_lib/cicd.py` (pipeline),
`scripts/synapse_lib/drift.py` (drift) and `scripts/synapse_ci.py` (CLI).
No cloud account, container runtime or external CI service is required.

## Triggers

- Manual: `python scripts/synapse_ci.py pipeline`.
- Git `pre-push` hook, installed by default when a project is created
  (`python scripts/synapse_ci.py install-hook --init-git`): runs the CI without
  building and blocks the push when it fails.
- GitHub Actions (optional): `.github/workflows/ci.yml` of Synapse calls the same CLI.

## CI

| Stage | What runs |
|-------|-----------|
| validate | `python scripts/audit_harness.py --universe <universe>` |
| tests | `python -m pytest -q tests` with a project-local temp dir (`artifacts/cicd/pytest-tmp`), so admin and non-admin runs never share temp folders |
| evals | `python scripts/run_evals.py <mode>` for each mode of the universe |
| build | versioned bundle in `artifacts/builds/<version>/` with `build_manifest.json` (SHA-256 per file, gate metrics, git commit) |

Eval gates per universe: ML `ml`; IA/Chatbolt `rag`, `retrieval`, `graph`,
`agent`, `fine_tuning`; Hybrid all of them. `voice` and `agentic_coding` run when
their case files exist (contract check without measured results).

## CD

Environments are local folders: `artifacts/releases/<env>/<version>/` plus a
`current.json` pointer with the promotion history.

| Promotion | Requires |
|-----------|----------|
| build -> dev | CI passed |
| dev -> staging | CI passed, same version in dev, no regression against staging |
| staging -> prod | CI passed, same version in staging, no regression against prod, named approver (`Maicon Adone`) |

`--version` is optional: without it `promote` takes the version currently in the
previous environment (the last passing build for dev), e.g.
`python scripts/synapse_ci.py promote --env prod --approver "Maicon Adone"`.

No regression means no tracked eval metric (pass rate, recall@k, MRR, nDCG,
pass^k, graph routing/entity/path/citation) is lower than in the version
currently live in the target environment - an offline shadow comparison.

After each promotion the smoke checks run inside the release folder: manifest
integrity (hashes), the smoke evals of the universe (ML `ml`, IA `agent`) and
the FastAPI `/health` probe when FastAPI is installed. A failed smoke check rolls
the pointer back automatically. Manual rollback:
`python scripts/synapse_ci.py rollback --env prod --reason <texto> --actor <nome>`.

`python scripts/synapse_ci.py serve --env prod` runs the promoted release with
uvicorn (template `templates/backend/fastapi_service.py`).

## Drift (ML and Hybrid)

`python scripts/synapse_ci.py drift --reference <treino.csv> --current <producao.csv>`
computes the Population Stability Index per feature (quantile bins for numbers,
categories otherwise; `--prediction-column` adds prediction drift). PSI >= 0.2 is
drift and >= 0.1 a warning (thresholds mirrored in the ML monitoring plan). Drift appends a
retraining request pending human approval to
`artifacts/cicd/retraining_requests.jsonl` and captures a failure in the
improvement loop; retraining follows the `ml-release` workflow and goes back
through the pipeline. Nothing retrains automatically.

## Traceability

Every CI run, promotion and rollback is appended to `artifacts/cicd/runs.jsonl`
with a markdown report in `artifacts/cicd/reports/`. `python scripts/synapse_ci.py status`
shows the live version per environment and the last runs.

## Connections

- Harness: components `cicd` (all universes) and `drift_monitoring` (ML, Hybrid).
- Workflows: `ml-release` and `rag-build` declare `executable_pipeline` commands.
- Fine-tuning (IA universes): fine-tuned models still need the fine-tuning
  release gate before the pipeline promotes them.
- LLM gateway and guardrails are exercised by the `agent` smoke eval; drift and
  pipeline failures feed `scripts/synapse_lib/improvement_loop.py`.
