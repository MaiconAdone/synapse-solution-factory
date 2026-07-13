from fastapi import APIRouter, Depends, HTTPException

from app.schemas.models import (
    ModelPredictionRequest,
    ModelPredictionResponse,
    ModelTrainingRequest,
    ModelTrainingResponse,
)
from app.security import require_api_key
from app.services.model_service import ModelNotFoundError, ModelService, ModelServiceError

router = APIRouter()
service = ModelService()


@router.get("", dependencies=[Depends(require_api_key)])
def list_models() -> dict[str, object]:
    return service.list_models()


@router.get("/{model_id}", dependencies=[Depends(require_api_key)])
def get_model(model_id: str) -> dict[str, object]:
    try:
        return service.get_model(model_id)
    except ModelNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@router.post("/train", response_model=ModelTrainingResponse, dependencies=[Depends(require_api_key)])
def train_model(request: ModelTrainingRequest) -> dict[str, object]:
    try:
        return service.train(request)
    except ModelServiceError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@router.post("/{model_id}/predict", response_model=ModelPredictionResponse, dependencies=[Depends(require_api_key)])
def predict(model_id: str, request: ModelPredictionRequest) -> dict[str, object]:
    try:
        return service.predict(model_id, request)
    except ModelNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except ModelServiceError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
