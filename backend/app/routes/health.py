from fastapi import APIRouter, Response, status

from app.core_config import get_settings
from app.db import get_engine
from app.services.ollama_service import OllamaService
from app.services.ruflo_service import RufloService

router = APIRouter()


@router.get("")
def health_check() -> dict[str, str]:
    settings = get_settings()
    return {
        "status": "ok",
        "environment": settings.environment,
        "memory_backend": settings.memory_backend,
        "swarm_topology": settings.swarm_topology,
    }


@router.get("/ready")
def readiness_check(response: Response) -> dict[str, object]:
    settings = get_settings()
    ollama = OllamaService(settings)
    try:
        ollama_status = ollama.status()
    finally:
        ollama.close()

    ruflo_status = RufloService().swarm_status()
    database = {"required": settings.project_creation_mode == "managed", "available": True}
    if database["required"]:
        try:
            with get_engine().connect() as connection:
                connection.exec_driver_sql("select 1")
        except Exception as error:
            database = {"required": True, "available": False, "error": str(error)}

    checks = {
        "ollama": bool(ollama_status.get("available")),
        "ruflo_mcp": bool(ruflo_status.get("available")),
        "database": bool(database["available"]),
    }
    required_checks = {
        "ollama": checks["ollama"] if settings.local_llm_enabled else True,
        "ruflo_mcp": checks["ruflo_mcp"] if settings.readiness_require_ruflo else True,
        "database": checks["database"],
    }
    ready = all(required_checks.values())
    if not ready:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return {
        "status": "ready" if ready else "degraded",
        "checks": checks,
        "required_checks": required_checks,
        "details": {
            "ollama": ollama_status,
            "ruflo_mcp": ruflo_status,
            "database": database,
        },
    }
