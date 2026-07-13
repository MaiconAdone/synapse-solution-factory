from app.orchestration.workflows import WORKFLOW_CATALOG
from app.services.ruflo_service import RufloService


class WorkflowRegistryService:
    def __init__(self, ruflo_service: RufloService | None = None) -> None:
        self.ruflo_service = ruflo_service or RufloService()

    def list_workflows(self) -> list[dict[str, object]]:
        return WORKFLOW_CATALOG

    def execute_workflow(self, workflow_id: str, agent_ids: list[str] | None = None, parallel: bool = True) -> dict[str, object]:
        known_ids = {workflow["id"] for workflow in WORKFLOW_CATALOG}
        if workflow_id not in known_ids:
            return {
                "available": False,
                "error": f"Unknown workflow: {workflow_id}",
                "known_workflows": sorted(known_ids),
            }
        return self.ruflo_service.execute_workflow(workflow_id, agent_ids, parallel)
