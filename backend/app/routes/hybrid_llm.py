from fastapi import APIRouter, Depends, HTTPException, status

from app.schemas.hybrid_llm import HybridLlmRequest
from app.security import require_api_key
from app.services.llm_dependencies import get_llm_gateway
from app.services.llm_gateway import LlmGateway, LlmGatewayError

router = APIRouter(dependencies=[Depends(require_api_key)])


@router.post("/decision")
def hybrid_llm_decision(
    request: HybridLlmRequest,
    service: LlmGateway = Depends(get_llm_gateway),
) -> dict[str, object]:
    try:
        return service.decide(request.prompt)
    except LlmGatewayError as error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(error)) from error


@router.post("/generate")
def hybrid_llm_generate(
    request: HybridLlmRequest,
    service: LlmGateway = Depends(get_llm_gateway),
) -> dict[str, object]:
    try:
        return service.generate(
            request.prompt,
            system=request.system,
            json_mode=request.json_mode,
            temperature=request.temperature,
            min_response_chars=request.min_response_chars,
            project_id=request.project_id,
            agent_id=request.agent_id,
            tool_name=request.tool_name,
        )
    except LlmGatewayError as error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(error),
        ) from error


@router.get("/metrics")
def hybrid_llm_metrics(
    service: LlmGateway = Depends(get_llm_gateway),
) -> dict[str, object]:
    return service.metrics.summary()
