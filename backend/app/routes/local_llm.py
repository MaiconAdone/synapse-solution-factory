from fastapi import APIRouter, Depends, HTTPException, status

from app.schemas.local_llm import LocalLlmGenerateRequest, LocalLlmGenerateResponse
from app.security import require_api_key
from app.services.llm_dependencies import get_llm_gateway, get_ollama_service
from app.services.llm_gateway import LlmGateway, LlmGatewayError
from app.services.ollama_service import OllamaService

router = APIRouter()


@router.get("/status")
def local_llm_status(
    service: OllamaService = Depends(get_ollama_service),
) -> dict[str, object]:
    return service.status()


@router.post(
    "/generate",
    response_model=LocalLlmGenerateResponse,
    dependencies=[Depends(require_api_key)],
)
def local_llm_generate(
    request: LocalLlmGenerateRequest,
    service: LlmGateway = Depends(get_llm_gateway),
) -> dict[str, object]:
    try:
        return service.generate(
            request.prompt,
            system=request.system,
            allow_cloud=False,
            force_provider="ollama",
            local_model=request.model,
            local_model_profile=request.model_profile or "fast",
            json_mode=request.json_mode,
            temperature=request.temperature,
            project_id="synapse-ai",
            agent_id="local-llm-route",
            tool_name="local_llm.generate",
        )
    except LlmGatewayError as error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(error),
        ) from error
