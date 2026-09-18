from fastapi import APIRouter, Response, status

from app.core_config import get_settings
from app.db import get_engine
from app.services.openai_service import OpenAiService

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
    openai = OpenAiService(settings)
    openai_status = {"provider": "openai", "configured": openai.configured}

    database = {"required": settings.project_creation_mode == "managed", "available": True}
    if database["required"]:
        try:
            with get_engine().connect() as connection:
                connection.exec_driver_sql("select 1")
        except Exception as error:
            database = {"required": True, "available": False, "error": str(error)}

    checks = {
        "openai": bool(openai_status.get("configured")),
        "database": bool(database["available"]),
    }
    required_checks = {
        "openai": checks["openai"],
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
            "openai": openai_status,
            "database": database,
        },
    }
