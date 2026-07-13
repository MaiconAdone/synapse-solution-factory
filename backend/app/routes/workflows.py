from fastapi import APIRouter, Depends

from app.schemas.workflows import WorkflowExecutionRequest
from app.security import require_api_key
from app.services.workflow_registry import WorkflowRegistryService

router = APIRouter()
service = WorkflowRegistryService()


@router.get("")
def list_workflows() -> list[dict[str, object]]:
    return service.list_workflows()


@router.post("/{workflow_id}/execute", dependencies=[Depends(require_api_key)])
def execute_workflow(workflow_id: str, request: WorkflowExecutionRequest) -> dict[str, object]:
    return service.execute_workflow(
        workflow_id=workflow_id,
        agent_ids=request.agent_ids,
        parallel=request.parallel_execution,
    )
