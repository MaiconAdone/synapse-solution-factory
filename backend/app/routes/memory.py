from fastapi import APIRouter, Depends

from app.security import require_api_key
from app.services.memory_service import MemoryService

router = APIRouter()
service = MemoryService()


@router.get("")
def memory_status() -> dict[str, object]:
    return service.status()


@router.get("/stats", dependencies=[Depends(require_api_key)])
def runtime_memory_stats() -> dict[str, object]:
    return service.runtime_stats()
