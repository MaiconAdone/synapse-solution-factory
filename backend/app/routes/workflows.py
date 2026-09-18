from fastapi import APIRouter

from app.services.workflow_registry import WorkflowRegistryService

router = APIRouter()
service = WorkflowRegistryService()


@router.get("")
def list_workflows() -> list[dict[str, object]]:
    return service.list_workflows()
