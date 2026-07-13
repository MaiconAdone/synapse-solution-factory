from functools import lru_cache

from app.core_config import get_settings
from app.services.hybrid_llm_router import HybridLlmRouter
from app.services.llm_gateway import LlmGateway
from app.services.ollama_service import OllamaService


@lru_cache
def get_ollama_service() -> OllamaService:
    return OllamaService(get_settings())


@lru_cache
def get_hybrid_llm_router() -> HybridLlmRouter:
    return HybridLlmRouter(get_settings(), ollama=get_ollama_service())


@lru_cache
def get_llm_gateway() -> LlmGateway:
    return LlmGateway(get_settings(), router=get_hybrid_llm_router())


def close_llm_services() -> None:
    if get_llm_gateway.cache_info().currsize:
        get_llm_gateway().close()
        get_llm_gateway.cache_clear()
    if get_hybrid_llm_router.cache_info().currsize:
        get_hybrid_llm_router().close()
        get_hybrid_llm_router.cache_clear()
        get_ollama_service.cache_clear()
    elif get_ollama_service.cache_info().currsize:
        get_ollama_service().close()
        get_ollama_service.cache_clear()
