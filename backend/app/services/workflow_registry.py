from app.orchestration.workflows import WORKFLOW_CATALOG


class WorkflowRegistryService:
    def list_workflows(self) -> list[dict[str, object]]:
        return WORKFLOW_CATALOG
