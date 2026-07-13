from fastapi import APIRouter, Depends, HTTPException

from app.schemas.evals import AiEvalRequest, EvalRunResponse, MlEvalRequest
from app.security import require_api_key
from app.services.eval_service import EvalService, EvalServiceError

router = APIRouter()
service = EvalService()


@router.post("/ml", response_model=EvalRunResponse, dependencies=[Depends(require_api_key)])
def run_ml_eval(request: MlEvalRequest) -> dict[str, object]:
    try:
        return service.run_ml_eval(model_id=request.model_id, cases_path=request.cases_path)
    except EvalServiceError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@router.post("/ai", response_model=EvalRunResponse, dependencies=[Depends(require_api_key)])
def run_ai_eval(request: AiEvalRequest) -> dict[str, object]:
    try:
        return service.run_ai_eval(cases_path=request.cases_path)
    except EvalServiceError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
