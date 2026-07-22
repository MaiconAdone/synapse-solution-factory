import json
import re
import subprocess
import zipfile
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from app.agents.required import REQUIRED_PARALLEL_AGENTS, SCALABLE_SWARM_AGENTS, SPECIALIST_AGENT_POOL
from app.core_config import Settings, get_settings
from app.repositories.projects import ProjectRepository
from app.schemas.projects import ProjectCreateRequest
from app.services.agent_blueprint_service import AgentBlueprintService
from app.services.agentic_mesh_governance import AgenticMeshGovernanceService
from app.services.business_solution_analyzer import BusinessSolutionAnalyzer
from app.services.cost_aware_router import CostAwareRouter
from app.services.enterprise_spec_service import EnterpriseSpecService
from app.services.ruflo_service import RufloService


PROJECT_SWARM_AGENTS = list(REQUIRED_PARALLEL_AGENTS)
PROJECT_SPECIALIST_AGENTS = list(SPECIALIST_AGENT_POOL)
PROJECT_MAX_SWARM_AGENTS = len(SCALABLE_SWARM_AGENTS)
ARCHIVE_EXCLUDED_DIRS = {
    ".git",
    ".next",
    ".pytest_cache",
    ".swarm",
    "__pycache__",
    "node_modules",
}
ARCHIVE_EXCLUDED_NAMES = {
    ".env",
    ".npmrc",
    ".pypirc",
    "agentdb.rvf",
    "agentdb.rvf.lock",
    "credentials.json",
    "id_ed25519",
    "id_rsa",
    "ruvector.db",
    "service-account.json",
}
ARCHIVE_EXCLUDED_SUFFIXES = {
    ".db",
    ".jks",
    ".keystore",
    ".key",
    ".lock",
    ".pem",
    ".pfx",
    ".p12",
    ".pyc",
    ".secret",
    ".sqlite",
}

PROJECT_UNIVERSES: dict[str, dict[str, object]] = {
    "ml": {
        "universe": "ml",
        "label": "ML",
        "project_type": "enterprise-ml-system",
        "solution_focus": "ml",
        "capabilities": {"ml": True, "ai": False, "rag": False, "data_treatment": True, "ruflo_15_agents": True, "ruflo_core_agents": 15, "ruflo_max_agents": 60, "ruflo_specialist_agents": 45},
    },
    "ia": {
        "universe": "ia",
        "label": "IA",
        "project_type": "enterprise-ai-agentic-system",
        "solution_focus": "agents",
        "capabilities": {"ml": False, "ai": True, "rag": True, "data_treatment": True, "ruflo_15_agents": True, "ruflo_core_agents": 15, "ruflo_max_agents": 60, "ruflo_specialist_agents": 45},
    },
    "chatbolt": {
        "universe": "chatbolt",
        "label": "Chatbolt",
        "project_type": "enterprise-chatbolt-agentic-system",
        "solution_focus": "chatbots",
        "capabilities": {"ml": False, "ai": True, "rag": True, "data_treatment": True, "ruflo_15_agents": True, "ruflo_core_agents": 15, "ruflo_max_agents": 60, "ruflo_specialist_agents": 45},
    },
    "hybrid": {
        "universe": "hybrid",
        "label": "ML + IA (Hibrido)",
        "project_type": "enterprise-hybrid-ml-ai-system",
        "solution_focus": "ai-ml-agents",
        "capabilities": {"ml": True, "ai": True, "rag": True, "data_treatment": True, "ruflo_15_agents": True, "ruflo_core_agents": 15, "ruflo_max_agents": 60, "ruflo_specialist_agents": 45},
    },
}


class ProjectFactoryError(ValueError):
    pass


class ProjectFactoryService:
    def __init__(
        self,
        root: Path | None = None,
        settings: Settings | None = None,
        ruflo: RufloService | None = None,
        enterprise_spec: EnterpriseSpecService | None = None,
        cost_router: CostAwareRouter | None = None,
        mesh_governance: AgenticMeshGovernanceService | None = None,
        blueprint_service: AgentBlueprintService | None = None,
        solution_analyzer: BusinessSolutionAnalyzer | None = None,
    ) -> None:
        self.root = root or Path(__file__).resolve().parents[3]
        self.settings = settings or get_settings()
        self.ruflo = ruflo or RufloService()
        self.enterprise_spec = enterprise_spec or EnterpriseSpecService()
        self.cost_router = cost_router or CostAwareRouter()
        self.mesh_governance = mesh_governance or AgenticMeshGovernanceService()
        self.blueprint_service = blueprint_service or AgentBlueprintService()
        self.solution_analyzer = solution_analyzer or BusinessSolutionAnalyzer(root=self.root)

    def create_project(
        self,
        request: ProjectCreateRequest,
        db_session: Session | None = None,
        owner_id: str | None = None,
    ) -> dict[str, Any]:
        project_name = self._validate_project_name(request.name)
        universe = self._resolve_project_universe(request.project_type)
        project_type = str(universe["project_type"])
        self._validate_business_context(request)
        business_solution_analysis = self.solution_analyzer.analyze(
            project_goal=request.project_goal,
            business_problem=request.business_problem,
            requested_universe=str(universe["universe"]),
            solution_focus=request.solution_focus,
            success_metric_or_acceptance_criteria=request.success_metric_or_acceptance_criteria,
            available_data_or_knowledge_sources=request.available_data_or_knowledge_sources,
            risk_level=request.risk_level,
        )
        cost_aware_activation = self.cost_router.route(
            f"{request.project_goal or ''} {request.business_problem or ''} {request.solution_focus or ''}",
            str(universe["universe"]),
        )
        agentic_mesh = self.mesh_governance.fleet_for_request(
            f"{request.project_goal or ''} {request.business_problem or ''} {request.solution_focus or ''}",
            str(universe["universe"]),
        )
        agent_blueprint = self.blueprint_service.build_blueprint(
            f"{request.project_goal or ''} {request.business_problem or ''} {request.solution_focus or ''}",
            str(universe["universe"]),
        )

        if self.settings.project_creation_mode == "managed":
            return self._create_managed_project(request, db_session, owner_id=owner_id)

        base_path = self._resolve_base_path()
        destination = base_path / project_name

        if destination.exists():
            raise ProjectFactoryError(f"Project already exists: {destination}")

        script_path = self.root / "scripts" / "create_ai_project.ps1"
        if not script_path.exists():
            raise ProjectFactoryError(f"Project factory script not found: {script_path}")

        command = [
            "powershell",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(script_path),
            "-NomeProjeto",
            project_name,
            "-TipoProjeto",
            str(universe["label"]),
            "-ProjectGoal",
            request.project_goal or "",
            "-BusinessProblem",
            request.business_problem or "",
            "-SolutionFocus",
            request.solution_focus or str(universe["solution_focus"]),
            "-SuccessMetric",
            request.success_metric_or_acceptance_criteria or "",
            "-AvailableSources",
            request.available_data_or_knowledge_sources or "",
            "-RiskLevel",
            request.risk_level or "",
            "-DestinoBase",
            str(base_path),
            "-ActiveAgentLimit",
            str(len(cost_aware_activation["core_agents"])),
        ]
        if request.activate_ruflo:
            command.append("-ActivateRuflo")

        try:
            completed = subprocess.run(
                command,
                cwd=self.root,
                capture_output=True,
                text=True,
                timeout=self.settings.project_factory_timeout_seconds,
                check=False,
            )
        except subprocess.TimeoutExpired as error:
            return {
                "project": project_name,
                "project_type": project_type,
                "destination": str(destination),
                "context_path": None,
                "returncode": 124,
                "created": destination.exists(),
                "stdout": error.stdout or "",
                "stderr": f"Timed out after {error.timeout} seconds",
            }
        except OSError as error:
            raise ProjectFactoryError(str(error)) from error

        context_path = None
        if completed.returncode == 0 and destination.exists():
            (destination / "data").mkdir(exist_ok=True)
            context_path = self._write_project_context(destination, request)
            self._write_business_solution_analysis(destination, business_solution_analysis)

        ruflo_activation = {
            "requested": request.activate_ruflo,
            "workflow": "new-ai-project",
            "parallel_execution": request.activate_ruflo,
            "source": "generated_project_runtime",
        }

        result = {
            "project": project_name,
            "project_type": project_type,
            "destination": str(destination),
            "context_path": str(context_path) if context_path else None,
            "returncode": completed.returncode,
            "created": completed.returncode == 0 and destination.exists(),
            "stdout": completed.stdout,
            "stderr": completed.stderr,
            "storage_backend": "local",
            "storage_bucket": None,
            "storage_prefix": str(destination),
            "data_storage_prefix": str(destination / "data"),
            "repository_url": None,
            "enterprise_spec": self.enterprise_spec.project_creation_defaults(),
            "project_universe": universe,
            "cost_aware_activation": cost_aware_activation,
            "agentic_mesh": agentic_mesh,
            "agent_blueprint": agent_blueprint,
            "business_solution_analysis": business_solution_analysis,
            "ruflo_activation": ruflo_activation,
        }
        if result["created"]:
            result["synapse_project_index"] = self._register_synapse_project(
                name=project_name,
                project_type=project_type,
                destination=str(destination),
                storage_backend="local",
                storage_bucket=None,
                storage_prefix=str(destination),
                data_storage_prefix=str(destination / "data"),
                repository_url=None,
                project_goal=request.project_goal,
                business_problem=request.business_problem,
                success_metric_or_acceptance_criteria=request.success_metric_or_acceptance_criteria,
                available_data_or_knowledge_sources=request.available_data_or_knowledge_sources,
                risk_level=request.risk_level,
                solution_focus=request.solution_focus,
                context_path=str(context_path) if context_path else None,
                universe=str(universe["universe"]),
            )
        return result

    def _create_managed_project(
        self,
        request: ProjectCreateRequest,
        db_session: Session | None,
        owner_id: str | None = None,
    ) -> dict[str, Any]:
        if db_session is None:
            raise ProjectFactoryError("DATABASE_URL and a database session are required for managed project creation")

        project_name = self._validate_project_name(request.name)
        universe = self._resolve_project_universe(request.project_type)
        project_type = str(universe["project_type"])
        business_solution_analysis = self.solution_analyzer.analyze(
            project_goal=request.project_goal,
            business_problem=request.business_problem,
            requested_universe=str(universe["universe"]),
            solution_focus=request.solution_focus,
            success_metric_or_acceptance_criteria=request.success_metric_or_acceptance_criteria,
            available_data_or_knowledge_sources=request.available_data_or_knowledge_sources,
            risk_level=request.risk_level,
        )
        cost_aware_activation = self.cost_router.route(
            f"{request.project_goal or ''} {request.business_problem or ''} {request.solution_focus or ''}",
            str(universe["universe"]),
        )
        agentic_mesh = self.mesh_governance.fleet_for_request(
            f"{request.project_goal or ''} {request.business_problem or ''} {request.solution_focus or ''}",
            str(universe["universe"]),
        )
        agent_blueprint = self.blueprint_service.build_blueprint(
            f"{request.project_goal or ''} {request.business_problem or ''} {request.solution_focus or ''}",
            str(universe["universe"]),
        )
        managed_request = request.model_copy(
            update={
                "name": project_name,
                "project_type": project_type,
                "solution_focus": str(universe["solution_focus"]),
            }
        )
        storage_backend = self.settings.project_storage_backend
        storage_bucket = self.settings.project_storage_bucket
        storage_prefix = f"projects/{project_name}"
        data_storage_prefix = f"{storage_prefix}/data"

        try:
            project = ProjectRepository(db_session).create_managed_project(
                managed_request,
                storage_backend=storage_backend,
                storage_bucket=storage_bucket,
                storage_prefix=storage_prefix,
                data_storage_prefix=data_storage_prefix,
                owner_id=owner_id,
            )
        except ValueError as error:
            raise ProjectFactoryError(str(error)) from error

        ruflo_activation = {
            "requested": managed_request.activate_ruflo,
            "workflow": "new-ai-project",
            "parallel_execution": True,
            "agents": cost_aware_activation["core_agents"],
            "active_agent_limit": cost_aware_activation["active_agent_limit"],
        }
        if managed_request.activate_ruflo:
            ruflo_activation.update(
                self.ruflo.execute_workflow(
                    "new-ai-project",
                    agent_ids=cost_aware_activation["core_agents"],
                    parallel=True,
                )
            )

        result = {
            "project": project.name,
            "project_type": project.project_type,
            "destination": f"{storage_backend}://{storage_bucket}/{storage_prefix}",
            "context_path": f"{storage_prefix}/docs/briefings/llm_ruflo_project_brief.md",
            "returncode": 0,
            "created": True,
            "stdout": "Managed project registered in database. Storage artifact generation is ready for Supabase/GitHub integration.",
            "stderr": "",
            "storage_backend": project.storage_backend,
            "storage_bucket": project.storage_bucket,
            "storage_prefix": project.storage_prefix,
            "data_storage_prefix": project.data_storage_prefix,
            "repository_url": project.repository_url,
            "enterprise_spec": self.enterprise_spec.project_creation_defaults(),
            "project_universe": universe,
            "cost_aware_activation": cost_aware_activation,
            "agentic_mesh": agentic_mesh,
            "agent_blueprint": agent_blueprint,
            "business_solution_analysis": business_solution_analysis,
            "managed_artifact_manifest": self._managed_artifact_manifest(project_name, universe),
            "ruflo_activation": ruflo_activation,
        }
        result["synapse_project_index"] = self._register_synapse_project(
            name=project.name,
            project_type=project.project_type,
            destination=result["destination"],
            storage_backend=project.storage_backend,
            storage_bucket=project.storage_bucket,
            storage_prefix=project.storage_prefix,
            data_storage_prefix=project.data_storage_prefix,
            repository_url=project.repository_url,
            project_goal=project.project_goal,
            business_problem=project.business_problem,
            success_metric_or_acceptance_criteria=request.success_metric_or_acceptance_criteria,
            available_data_or_knowledge_sources=request.available_data_or_knowledge_sources,
            risk_level=request.risk_level,
            solution_focus=project.solution_focus,
            context_path=result["context_path"],
            universe=str(universe["universe"]),
            owner_id=owner_id,
        )
        return result

    def list_local_projects(self) -> list[dict[str, Any]]:
        base_path = self._resolve_base_path()
        projects_by_name = {
            project["name"]: project
            for project in self._load_synapse_project_index()["projects"]
            if project.get("storage_backend") == "local"
        }
        for path in sorted((item for item in base_path.iterdir() if item.is_dir()), key=lambda item: item.name.lower()):
            data_path = path / "data"
            existing = projects_by_name.get(path.name, {})
            projects_by_name[path.name] = {
                "name": path.name,
                "project_type": existing.get("project_type", "local"),
                "status": existing.get("status", "created"),
                "destination": str(path),
                "storage_backend": "local",
                "storage_bucket": None,
                "storage_prefix": str(path),
                "data_storage_prefix": str(data_path),
                "repository_url": existing.get("repository_url"),
                "created_by_synapse": bool(existing.get("created_by_synapse", False)),
                "synapse_registered_at": existing.get("synapse_registered_at"),
            }
        return sorted(projects_by_name.values(), key=lambda item: str(item["name"]).lower())

    def get_local_project(self, project_name: str) -> dict[str, Any]:
        project_name = self._validate_project_name(project_name)
        base_path = self._resolve_base_path()
        destination = base_path / project_name
        if not destination.exists() or not destination.is_dir():
            raise ProjectFactoryError(f"Project not found: {project_name}")
        data_path = destination / "data"
        data_path.mkdir(exist_ok=True)
        indexed = self._indexed_project(project_name)
        return {
            "name": project_name,
            "project_type": indexed.get("project_type", "local") if indexed else "local",
            "status": "created",
            "destination": str(destination),
            "storage_backend": "local",
            "storage_bucket": None,
            "storage_prefix": str(destination),
            "data_storage_prefix": str(data_path),
            "repository_url": None,
            "project_goal": indexed.get("project_goal") if indexed else None,
            "business_problem": indexed.get("business_problem") if indexed else None,
            "success_metric_or_acceptance_criteria": indexed.get("success_metric_or_acceptance_criteria") if indexed else None,
            "available_data_or_knowledge_sources": indexed.get("available_data_or_knowledge_sources") if indexed else None,
            "risk_level": indexed.get("risk_level") if indexed else None,
            "solution_focus": indexed.get("solution_focus", "ai-ml-agents") if indexed else "ai-ml-agents",
            "created_by_synapse": bool(indexed),
            "synapse_registered_at": indexed.get("synapse_registered_at") if indexed else None,
        }

    def create_local_project_archive(self, project_name: str) -> bytes:
        project_name = self._validate_project_name(project_name)
        base_path = self._resolve_base_path()
        destination = base_path / project_name
        if not destination.exists() or not destination.is_dir():
            raise ProjectFactoryError(f"Project not found: {project_name}")

        archive = BytesIO()
        with zipfile.ZipFile(archive, mode="w", compression=zipfile.ZIP_DEFLATED) as zip_file:
            for path in destination.rglob("*"):
                if path.is_file() and self._is_safe_archive_path(path, destination):
                    zip_file.write(path, path.relative_to(destination.parent).as_posix())
        archive.seek(0)
        return archive.getvalue()

    def _is_safe_archive_path(self, path: Path, project_root: Path) -> bool:
        if path.is_symlink():
            return False
        relative = path.relative_to(project_root)
        if any(part in ARCHIVE_EXCLUDED_DIRS for part in relative.parts):
            return False
        name = path.name.lower()
        if name in ARCHIVE_EXCLUDED_NAMES or name.startswith(".env."):
            return False
        return path.suffix.lower() not in ARCHIVE_EXCLUDED_SUFFIXES

    def _resolve_base_path(self) -> Path:
        base_path = Path(self.settings.project_factory_base_path).resolve()
        base_path.mkdir(parents=True, exist_ok=True)
        return base_path

    def _project_index_path(self) -> Path:
        path = Path(self.settings.synapse_project_index_path)
        if not path.is_absolute():
            path = self.root / path
        path.parent.mkdir(parents=True, exist_ok=True)
        return path

    def _load_synapse_project_index(self) -> dict[str, Any]:
        path = self._project_index_path()
        if not path.exists():
            return {
                "schema": "synapse-project-index.v1",
                "owner": "synapse",
                "projects": [],
            }
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return {
                "schema": "synapse-project-index.v1",
                "owner": "synapse",
                "projects": [],
            }
        if not isinstance(data, dict):
            return {
                "schema": "synapse-project-index.v1",
                "owner": "synapse",
                "projects": [],
            }
        if not isinstance(data.get("projects"), list):
            data["projects"] = []
        data.setdefault("schema", "synapse-project-index.v1")
        data.setdefault("owner", "synapse")
        return data

    def _save_synapse_project_index(self, index: dict[str, Any]) -> str:
        path = self._project_index_path()
        path.write_text(json.dumps(index, indent=2, ensure_ascii=False), encoding="utf-8")
        return str(path)

    def _register_synapse_project(
        self,
        *,
        name: str,
        project_type: str,
        destination: str,
        storage_backend: str,
        storage_bucket: str | None,
        storage_prefix: str,
        data_storage_prefix: str,
        repository_url: str | None,
        project_goal: str | None,
        business_problem: str | None,
        success_metric_or_acceptance_criteria: str | None,
        available_data_or_knowledge_sources: str | None,
        risk_level: str | None,
        solution_focus: str,
        context_path: str | None,
        universe: str,
        owner_id: str | None = None,
    ) -> dict[str, Any]:
        index = self._load_synapse_project_index()
        now = datetime.now(timezone.utc).isoformat()
        entry = {
            "name": name,
            "project_type": project_type,
            "status": "created",
            "destination": destination,
            "storage_backend": storage_backend,
            "storage_bucket": storage_bucket,
            "storage_prefix": storage_prefix,
            "data_storage_prefix": data_storage_prefix,
            "repository_url": repository_url,
            "project_goal": project_goal,
            "business_problem": business_problem,
            "success_metric_or_acceptance_criteria": success_metric_or_acceptance_criteria,
            "available_data_or_knowledge_sources": available_data_or_knowledge_sources,
            "risk_level": risk_level,
            "solution_focus": solution_focus,
            "context_path": context_path,
            "universe": universe,
            "owner_id": owner_id,
            "created_by_synapse": True,
            "synapse_registered_at": now,
            "last_seen_at": now,
        }
        index["projects"] = sorted(
            [
                project
                for project in index["projects"]
                if not (
                    project.get("name") == name
                    and project.get("storage_backend") == storage_backend
                )
            ]
            + [entry],
            key=lambda item: str(item.get("name", "")).lower(),
        )
        path = self._save_synapse_project_index(index)
        return {
            "path": path,
            "registered": True,
            "project": name,
            "created_by_synapse": True,
        }

    def _indexed_project(self, project_name: str) -> dict[str, Any] | None:
        for project in self._load_synapse_project_index()["projects"]:
            if project.get("name") == project_name:
                return project
        return None

    def _validate_project_name(self, value: str) -> str:
        project_name = value.strip()
        if not re.fullmatch(r"[A-Za-z0-9_-]+", project_name):
            raise ProjectFactoryError("Use only letters, numbers, underscore, or hyphen in project name")
        return project_name

    def _validate_project_type(self, value: str) -> str:
        project_type = value.strip()
        if not re.fullmatch(r"[A-Za-z0-9_.-]+", project_type):
            raise ProjectFactoryError("Invalid project type")
        return project_type

    def _resolve_project_universe(self, value: str) -> dict[str, object]:
        normalized = re.sub(r"[^a-z0-9]+", "-", value.strip().lower()).strip("-")
        if normalized == "ml":
            return PROJECT_UNIVERSES["ml"]
        if normalized in {"ia", "ai"}:
            return PROJECT_UNIVERSES["ia"]
        if normalized in {
            "ml-ia-hibrido",
            "ml-ai-hybrid",
            "ml-ia",
            "ml-ai",
            "hibrido",
            "hybrid",
            "b2b2c-ai-ml-agentic-saas",
            "enterprise-hybrid-ml-ai-system",
        }:
            return PROJECT_UNIVERSES["hybrid"]
        if normalized in {"chatbolt", "chat-bolt", "chat-bolt-system", "enterprise-chatbolt-agentic-system"}:
            return PROJECT_UNIVERSES["chatbolt"]
        if normalized == "enterprise-ml-system":
            return PROJECT_UNIVERSES["ml"]
        if normalized == "enterprise-ai-agentic-system":
            return PROJECT_UNIVERSES["ia"]
        raise ProjectFactoryError("Project universe must be ML, IA, ML + IA (Hibrido), or Chatbolt")

    def _validate_business_context(self, request: ProjectCreateRequest) -> None:
        if not request.require_business_problem:
            return
        missing = []
        if not (request.business_problem or "").strip():
            missing.append("business_problem")
        if not (request.success_metric_or_acceptance_criteria or "").strip():
            missing.append("success_metric_or_acceptance_criteria")
        if not (request.available_data_or_knowledge_sources or "").strip():
            missing.append("available_data_or_knowledge_sources")
        if not (request.risk_level or "").strip():
            missing.append("risk_level")
        if missing:
            raise ProjectFactoryError(
                "Ask the user for missing project context before creating the project: " + ", ".join(missing)
            )

    def _managed_artifact_manifest(self, project_name: str, universe: dict[str, object]) -> dict[str, Any]:
        capabilities = universe["capabilities"]
        ai_enabled = bool(capabilities["ai"])
        ml_enabled = bool(capabilities["ml"])
        required_paths = [
            "AGENTS.md",
            "CLAUDE.md",
            ".adonex/memory/AGENT_CONTEXT.md",
            ".adonex/memory/CURRENT_STATE.md",
            ".adonex/memory/SHARED_DIALOG_MEMORY.md",
            ".adonex/memory/CHAT_TASKS.md",
            ".mcp.json",
            ".vscode/settings.json",
            ".vscode/extensions.json",
            ".vscode/tasks.json",
            "adonex/package.json",
            "adonex/tsconfig.json",
            "adonex/src/extension.ts",
            "adonex/src/agent/agentOrchestrator.ts",
            "adonex/src/patch/patchEngine.ts",
            "adonex/src/patch/patchUtils.ts",
            "adonex/src/llm/localModels.ts",
            "adonex/src/tasks/taskFinalizer.ts",
            "adonex/test",
            "config/synapse_solution_contract.json",
            "config/project_universe.json",
            "config/business_solution_analysis.json",
            "config/runtime_manifest.json",
            "config/context_policy.json",
            "config/data_treatment_policy.json",
            "config/cost_optimization_policy.json",
            "config/agent_trust_framework.json",
            "config/agent_fleets.json",
            "config/agent_blueprint_contract.json",
            "config/agentic_architectural_patterns.json",
            "config/agent_improvement_loop.json",
            "config/llm_solution_factory_policy.json",
            "config/model_providers.json",
            "docs/runbooks/adonex.md",
            "docs/runbooks/peer_messaging.md",
            "docs/briefings/business_solution_analysis.md",
            "docs/specifications/ai_ml_execution_spec.md",
            "docs/specifications/agentic_architectural_patterns.md",
            "prompts/master_data_treatment.md",
            "prompts/codex_data_treatment_dialog.md",
            "scripts/synapse_solution_peers_mcp.py",
            "scripts/start_vick.py",
            "scripts/start_ruflo_swarm.ps1",
            "scripts/treat_dataset.py",
            "tests/test_project_contract.py",
            "tests/test_evals_contract.py",
            "tests/test_data_contract.py",
            "agents/definitions/enterprise_agents.yaml",
        ]
        if ai_enabled:
            required_paths.extend(
                [
                    "config/ai_framework_selection.json",
                    "docs/specifications/ai_framework_selection.md",
                    "docs/specifications/technology_layer.md",
                    "rag_pipelines",
                    "tests/test_ai_contract.py",
                ]
            )
        if ml_enabled:
            required_paths.extend(
                [
                    "config/ml_foundations_policy.json",
                    "docs/specifications/ml_foundations.md",
                    "ml_systems/model_card.md",
                    "evals/ml_cases.jsonl",
                    "tests/test_ml_contract.py",
                ]
            )
        if str(universe["universe"]) == "chatbolt":
            required_paths.extend(
                [
                    "prompts/chatbot_assistant.md",
                    "docs/specifications/chatbot_design_spec.md",
                    "docs/runbooks/chatbot_operations.md",
                    "docs/checklists/chatbot_quality_checklist.md",
                    "evals/chatbot_cases.jsonl",
                    "config/chatbot_config.yaml",
                    "tests/test_chatbot_contract.py",
                ]
            )
        return {
            "project": project_name,
            "universe": universe["universe"],
            "artifact_generation": "required_for_storage_materialization",
            "assistant_inheritance": {
                "user_request_channels": ["VS Code Chat", "AdoneX", "Claude Code", "Codex"],
                "content_collection_rule": (
                    "Goals, constraints, files, decisions, approvals and missing briefing fields must be "
                    "collected or confirmed through authorized assistant chats before tasks, scripts, "
                    "browser UI or tools are used."
                ),
                "shared_solution_factory_access": {
                    "policy": "config/llm_solution_factory_policy.json",
                    "technology_catalog": "config/ai_framework_selection.json",
                    "business_analysis": "config/business_solution_analysis.json",
                    "business_briefing": "docs/briefings/business_solution_analysis.md",
                    "governance": "docs/specifications/llm_solution_factory_governance.md",
                    "technology_layer": "docs/specifications/technology_layer.md",
                    "ml_foundations_policy": "config/ml_foundations_policy.json",
                    "ml_foundations_spec": "docs/specifications/ml_foundations.md",
                    "shared_dialog_memory": ".adonex/memory/SHARED_DIALOG_MEMORY.md",
                    "chat_tasks": ".adonex/memory/CHAT_TASKS.md",
                    "peer_mailbox": "synapse-peers",
                    "tests": "tests",
                    "evals": "evals",
                },
                "codex": {"instructions": "AGENTS.md"},
                "claude": {"instructions": "CLAUDE.md", "cloud_requires_explicit_user_request": True},
                "adonex": {
                    "settings": ".vscode/settings.json",
                    "default_mode": "local",
                    "runtime": "adonex",
                    "package": "adonex/package.json",
                    "source": "adonex/src",
                    "tests": "adonex/test",
                    "complete_runtime": True,
                    "excluded_runtime_paths": [
                        "adonex/node_modules",
                        "adonex/dist",
                        "adonex/.vscode-test",
                        "adonex/coverage",
                        "adonex/debug.log",
                    ],
                    "coding_capabilities": [
                        "incremental_patch_operations",
                        "workspace_conflict_detection",
                        "structured_failure_diagnosis",
                        "local_model_profiles",
                        "ruflo_selective_council",
                    ],
                },
                "vick": {
                    "enabled": True,
                    "browser_assistant": "scripts/start_vick.py",
                    "wake_word": "Vick",
                    "auto_open_task": ".vscode/tasks.json",
                    "startup": "VS Code folderOpen task",
                    "purpose": (
                        "Initial browser interaction for corporate-solution briefing, inheriting "
                        "AdoneX and Synapse Solution Factory governance."
                    ),
                },
                "peer_messaging": {
                    "server": "synapse-peers",
                    "script": "scripts/synapse_solution_peers_mcp.py",
                    "db_path": "./artifacts/peers/synapse-peers.db",
                    "max_message_chars": 1200,
                    "max_summary_chars": 360,
                },
                "shared_dialog_memory": {
                    "enabled": True,
                    "persistent_context": ".adonex/memory/SHARED_DIALOG_MEMORY.md",
                    "chat_tasks": ".adonex/memory/CHAT_TASKS.md",
                    "current_state": ".adonex/memory/CURRENT_STATE.md",
                    "peer_mailbox": "synapse-peers",
                    "applies_to": ["vscode-chat", "codex", "claude-code", "adonex"],
                },
            },
            "local_model_policy": {
                "allowed_models": [
                    "nomic-embed-text:latest",
                    "qwen2.5-coder:3b",
                    "qwen3:8b",
                    "deepseek-coder-v2:lite",
                    "qwen2.5-coder:14b",
                    "qwen3:14b",
                    "deepseek-r1:14b",
                    "qwen2.5-coder:32b",
                ],
                "fast": "qwen2.5-coder:3b",
                "general": "qwen3:8b",
                "balanced": "deepseek-coder-v2:lite",
                "code_review": "deepseek-coder-v2:lite",
                "code_strong": "qwen2.5-coder:14b",
                "planning_strong": "qwen3:14b",
                "reasoning_strong": "deepseek-r1:14b",
                "code_critical": "qwen2.5-coder:32b",
                "embeddings": "nomic-embed-text:latest",
            },
            "agentic_architectural_patterns": {
                "catalog": "config/agentic_architectural_patterns.json",
                "docs": "docs/specifications/agentic_architectural_patterns.md",
                "patterns": [
                    "orchestrator-specialist",
                    "critic-reviewer-gate",
                    "a2a-message-contract",
                    "tool-gateway",
                    "model-router",
                    "shared-memory-retrieval",
                    "lifecycle-callbacks",
                ],
                "callbacks_are_audit_events": True,
            },
            "cost_policy": {
                "default_active_agents": 1,
                "enterprise_active_agents": 8,
                "max_available_agents": 60,
                "activate_all_60_requires_explicit_high_complexity": True,
            },
            "ruflo_strategy": {
                "inheritance_mode": "solution_runtime",
                "default_activation": "one_orchestrator_first",
                "available_agents": 60,
                "core_agents": 15,
                "specialist_agents": 45,
                "full_activation_requires": [
                    "explicit_high_complexity_request",
                    "human_approval",
                    "cost_budget_review",
                    "role_specific_context_filtering",
                ],
                "recommended_fleets_by_universe": {
                    "ml": ["ml_fleet", "data_fleet", "quality_fleet"],
                    "ia": ["rag_fleet", "mcp_fleet", "security_fleet"],
                    "chatbolt": ["rag_fleet", "mcp_fleet", "quality_fleet"],
                    "hybrid": ["project_factory_fleet", "ml_fleet", "rag_fleet", "cost_optimization_fleet"],
                },
            },
            "test_layer": {
                "path": "tests",
                "purpose": "deterministic project contracts and universe-specific structure checks",
                "run_command": "python -m pytest tests",
                "complements": "evals",
            },
            "required_paths": required_paths,
            "forbidden_paths": [
                "backend",
                "frontend",
                "scripts/create_ai_project.ps1",
                "scripts/synapse_peers_mcp.py",
            ],
        }

    def _write_project_context(self, destination: Path, request: ProjectCreateRequest) -> Path | None:
        if not any((request.project_goal, request.business_problem, request.solution_focus)):
            return None

        context_dir = destination / "docs" / "briefings"
        context_dir.mkdir(parents=True, exist_ok=True)
        context_path = context_dir / "llm_ruflo_project_brief.md"
        content = "\n".join(
            [
                "# Briefing LLM + Ruflo",
                "",
                "Este arquivo orienta o LLM, o Ruflo e os agentes autonomos antes de criar modelos de ML ou agentes de IA.",
                "",
                "## Pedido inicial",
                (request.project_goal or "Nao informado.").strip(),
                "",
                "## Problema de negocio",
                (request.business_problem or "Nao informado.").strip(),
                "",
                "## Metrica de sucesso ou criterio de aceite",
                (request.success_metric_or_acceptance_criteria or "Nao informado.").strip(),
                "",
                "## Dados, documentos ou fontes disponiveis",
                (request.available_data_or_knowledge_sources or "Nao informado.").strip(),
                "",
                "## Nivel de risco",
                (request.risk_level or "Nao informado.").strip(),
                "",
                "## Foco da solucao",
                request.solution_focus.strip() or "ai-ml-agents",
                "",
                "## Regras de execucao",
                f"- SDD gate: {self.enterprise_spec.sdd_gate()['gate']}",
                "- Ruflo mantem 15 core agents e 45 especialistas disponiveis, ativando apenas o subconjunto necessario conforme custo e complexidade.",
                "- Cada solicitacao no dialogo do Codex deve seguir estes passos:",
                *[f"  - {step}" for step in self.enterprise_spec.required_request_steps()],
                "- Antes de treinar modelos de ML, confirmar objetivo de negocio, metrica de sucesso, dados disponiveis e criterio de aceite.",
                "- Antes de criar agentes de IA, confirmar processo de negocio, limites de autonomia, ferramentas permitidas e criterios de seguranca.",
                "- Antes de acionar LLMs caros ou muitos agentes, aplicar config/cost_optimization_policy.json.",
                "- Antes de compor times de agentes, aplicar config/agent_fleets.json e config/agent_trust_framework.json.",
                "- Cada fleet deve respeitar identidade, permissoes, proposito, explicabilidade, observabilidade, certificacao e lifecycle governance.",
                "- Manter 60 agentes disponiveis, mas ativar apenas o conjunto minimo util para o cenario.",
                "- Usar cache, compressao de contexto, deduplicacao e roteamento por tier de modelo para reduzir tokens OpenAI/Anthropic.",
                "- Registrar experimentos no registry local quando houver treino, avaliacao ou promocao de modelo.",
                "- Rodar testes separados de ML e IA antes de liberar qualquer fluxo.",
                "- Manter este briefing como fonte de contexto para Ruflo, Codex e agentes autonomos.",
                "",
            ]
        )
        context_path.write_text(content, encoding="utf-8")
        return context_path

    def _write_business_solution_analysis(self, destination: Path, analysis: dict[str, Any]) -> dict[str, str]:
        config_path = destination / "config" / "business_solution_analysis.json"
        docs_path = destination / "docs" / "briefings" / "business_solution_analysis.md"
        config_path.parent.mkdir(parents=True, exist_ok=True)
        docs_path.parent.mkdir(parents=True, exist_ok=True)
        config_path.write_text(json.dumps(analysis, indent=2, ensure_ascii=False), encoding="utf-8")
        docs_path.write_text(self.solution_analyzer.to_markdown(analysis), encoding="utf-8")
        return {"config": str(config_path), "briefing": str(docs_path)}

