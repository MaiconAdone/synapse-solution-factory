import json
from pathlib import Path
from threading import Lock

from app.core_config import Settings, get_settings
from app.orchestration.transformation_workflow import TransformationWorkflow
from app.schemas.business_transformation import (
    ApprovalDecision,
    BusinessObjective,
    WorkflowState,
)


class BusinessTransformationService:
    def __init__(
        self,
        workflow: TransformationWorkflow | None = None,
        settings: Settings | None = None,
        store_path: Path | None = None,
    ) -> None:
        self.workflow = workflow or TransformationWorkflow()
        self.settings = settings or get_settings()
        self.store_path = store_path or Path(self.settings.business_transformation_store_path)
        self._lock = Lock()

    def diagnose(self, objective: BusinessObjective) -> dict[str, object]:
        return self.workflow.diagnose(objective)

    def opportunities(self, objective: BusinessObjective) -> dict[str, object]:
        return self.workflow.find_opportunities(objective)

    def execute(
        self,
        objective: BusinessObjective,
        *,
        owner_id: str = "local-admin",
        project_id: str = "synapse-ai",
    ) -> WorkflowState:
        state = self.workflow.start(objective)
        self._save(state, owner_id=owner_id, project_id=project_id)
        return state

    def approve(
        self,
        workflow_id: str,
        decision: ApprovalDecision,
        *,
        requester_id: str = "local-admin",
        is_admin: bool = True,
    ) -> WorkflowState:
        record = self._load_record(workflow_id)
        self._authorize(record, requester_id=requester_id, is_admin=is_admin)
        state = WorkflowState.model_validate(record["state"])
        updated = self.workflow.approve(
            state,
            approved=decision.approved,
            approver=requester_id,
            notes=decision.notes,
        )
        self._save(
            updated,
            owner_id=str(record["owner_id"]),
            project_id=str(record["project_id"]),
        )
        return updated

    def get(
        self,
        workflow_id: str,
        *,
        requester_id: str = "local-admin",
        is_admin: bool = True,
    ) -> WorkflowState:
        record = self._load_record(workflow_id)
        self._authorize(record, requester_id=requester_id, is_admin=is_admin)
        return WorkflowState.model_validate(record["state"])

    def audit(
        self,
        workflow_id: str,
        *,
        requester_id: str = "local-admin",
        is_admin: bool = True,
    ) -> list[dict[str, object]]:
        state = self.get(workflow_id, requester_id=requester_id, is_admin=is_admin)
        return [event.model_dump(mode="json") for event in state.audit]

    def _save(self, state: WorkflowState, *, owner_id: str, project_id: str) -> None:
        self.store_path.mkdir(parents=True, exist_ok=True)
        path = self.store_path / f"{state.workflow_id}.json"
        temporary = path.with_suffix(".tmp")
        record = {
            "owner_id": owner_id,
            "project_id": project_id,
            "state": state.model_dump(mode="json"),
        }
        with self._lock:
            temporary.write_text(
                json.dumps(record, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            temporary.replace(path)

    def _load_record(self, workflow_id: str) -> dict[str, object]:
        if not workflow_id.replace("-", "").isalnum():
            raise KeyError(workflow_id)
        path = self.store_path / f"{workflow_id}.json"
        if not path.exists():
            raise KeyError(workflow_id)
        with self._lock:
            return json.loads(path.read_text(encoding="utf-8"))

    @staticmethod
    def _authorize(
        record: dict[str, object],
        *,
        requester_id: str,
        is_admin: bool,
    ) -> None:
        if not is_admin and record.get("owner_id") != requester_id:
            raise PermissionError("Workflow belongs to another user")
