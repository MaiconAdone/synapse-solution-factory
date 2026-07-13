from functools import lru_cache

from app.core_config import get_settings
from app.services.governed_swarm_execution import GovernedSwarmExecutionService
from app.services.llm_dependencies import get_llm_gateway


@lru_cache
def get_governed_swarm_service() -> GovernedSwarmExecutionService:
    return GovernedSwarmExecutionService(
        settings=get_settings(),
        llm_gateway=get_llm_gateway(),
    )


def close_governed_swarm_service() -> None:
    get_governed_swarm_service.cache_clear()
