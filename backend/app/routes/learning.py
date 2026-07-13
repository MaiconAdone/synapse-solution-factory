from fastapi import APIRouter, Depends, HTTPException, status

from app.schemas.learning import LearningFeedbackRequest
from app.security import AuthContext, require_api_key
from app.services.continual_learning_service import (
    ContinualLearningError,
    ContinualLearningService,
)

router = APIRouter(dependencies=[Depends(require_api_key)])
service = ContinualLearningService()


@router.get("/summary")
def learning_summary() -> dict[str, object]:
    return service.summary()


@router.get("/retrieve")
def retrieve_learning(q: str, project_id: str = "synapse-ai", limit: int = 3) -> dict[str, object]:
    return service.retrieve(q, project_id=project_id, limit=max(1, min(limit, 10)))


@router.post("/feedback")
def learning_feedback(
    request: LearningFeedbackRequest,
    auth: AuthContext = Depends(require_api_key),
) -> dict[str, object]:
    approver = auth.user_id or auth.role or auth.mode
    try:
        return service.apply_feedback(
            execution_id=request.execution_id,
            project_id=request.project_id,
            approved=request.approved,
            score=request.score,
            notes=request.notes,
            scope=request.scope,
            approver=approver,
            global_promotion_authorized=auth.is_admin,
        )
    except ContinualLearningError as error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(error)) from error
