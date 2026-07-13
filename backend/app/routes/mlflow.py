from fastapi import APIRouter, Depends, Query

from app.schemas.mlflow import ModelAliasRequest
from app.security import require_api_key
from app.services.mlflow_service import MlflowService

router = APIRouter()
service = MlflowService()


@router.get("/status")
def mlflow_status() -> dict[str, object]:
    return service.status()


@router.get("/experiments", dependencies=[Depends(require_api_key)])
def list_experiments() -> dict[str, object]:
    return service.list_experiments()


@router.get("/runs", dependencies=[Depends(require_api_key)])
def list_runs(max_results: int = Query(default=20, ge=1, le=100)) -> dict[str, object]:
    return service.list_runs(max_results=max_results)


@router.get("/models", dependencies=[Depends(require_api_key)])
def list_registered_models() -> dict[str, object]:
    return service.list_registered_models()


@router.post("/models/alias", dependencies=[Depends(require_api_key)])
def set_model_alias(request: ModelAliasRequest) -> dict[str, object]:
    return service.set_model_alias(
        model_name=request.model_name,
        version=request.version,
        alias=request.alias,
    )
