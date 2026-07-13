from fastapi import APIRouter, Depends, HTTPException, status

from app.schemas.governed_swarm import GovernedSwarmExecutionRequest
from app.security import require_api_key
from app.services.governed_swarm_dependencies import get_governed_swarm_service
from app.services.governed_swarm_execution import (
    GovernedSwarmExecutionError,
    GovernedSwarmExecutionService,
)
from app.services.swarm_service import SwarmService

router = APIRouter()
service = SwarmService()


@router.get("")
def swarm_status() -> dict[str, object]:
    return service.status()


@router.get("/status", dependencies=[Depends(require_api_key)])
def runtime_swarm_status() -> dict[str, object]:
    return service.runtime_status()


@router.post("/governed/plan", dependencies=[Depends(require_api_key)])
def governed_swarm_plan(
    request: GovernedSwarmExecutionRequest,
    governed: GovernedSwarmExecutionService = Depends(get_governed_swarm_service),
) -> dict[str, object]:
    try:
        return governed.plan(
            request.prompt,
            universe=request.universe,
            allow_cloud=request.allow_cloud,
            activate_all_60=request.activate_all_60,
            human_approved=request.human_approved,
        )
    except GovernedSwarmExecutionError as error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(error)) from error


@router.post("/governed/execute", dependencies=[Depends(require_api_key)])
def governed_swarm_execute(
    request: GovernedSwarmExecutionRequest,
    governed: GovernedSwarmExecutionService = Depends(get_governed_swarm_service),
) -> dict[str, object]:
    try:
        return governed.execute(
            request.prompt,
            universe=request.universe,
            allow_cloud=request.allow_cloud,
            activate_all_60=request.activate_all_60,
            human_approved=request.human_approved,
            json_mode=request.json_mode,
            min_response_chars=request.min_response_chars,
            project_id=request.project_id,
        )
    except GovernedSwarmExecutionError as error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(error)) from error


@router.get("/governed/audit", dependencies=[Depends(require_api_key)])
def governed_swarm_audit(
    governed: GovernedSwarmExecutionService = Depends(get_governed_swarm_service),
) -> dict[str, object]:
    return governed.audit_summary()
