from fastapi import APIRouter

from app.services.swarm_service import SwarmService

router = APIRouter()
service = SwarmService()


@router.get("")
def swarm_status() -> dict[str, object]:
    return service.status()
