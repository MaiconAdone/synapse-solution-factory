from fastapi import APIRouter, Depends, HTTPException, status

from app.schemas.business_transformation import ApprovalDecision, BusinessObjective
from app.security import AuthContext, require_api_key
from app.services.business_transformation_service import BusinessTransformationService

router = APIRouter()
service = BusinessTransformationService()


def _requester_id(auth: AuthContext) -> str:
    return auth.user_id or "local-admin"


@router.post("/diagnosis")
def business_diagnosis(
    objective: BusinessObjective,
    _auth: AuthContext = Depends(require_api_key),
) -> dict[str, object]:
    return service.diagnose(objective)


@router.post("/opportunities")
def business_opportunities(
    objective: BusinessObjective,
    _auth: AuthContext = Depends(require_api_key),
) -> dict[str, object]:
    return service.opportunities(objective)


@router.post("/transformation")
def run_business_transformation(
    objective: BusinessObjective,
    auth: AuthContext = Depends(require_api_key),
) -> dict[str, object]:
    return service.execute(
        objective,
        owner_id=_requester_id(auth),
    ).model_dump(mode="json")


@router.post("/transformation/{workflow_id}/approve")
def approve_business_transformation(
    workflow_id: str,
    decision: ApprovalDecision,
    auth: AuthContext = Depends(require_api_key),
) -> dict[str, object]:
    try:
        return service.approve(
            workflow_id,
            decision,
            requester_id=_requester_id(auth),
            is_admin=auth.is_admin,
        ).model_dump(mode="json")
    except KeyError as error:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workflow not found") from error
    except PermissionError as error:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(error)) from error


@router.get("/transformation/{workflow_id}")
def get_business_transformation(
    workflow_id: str,
    auth: AuthContext = Depends(require_api_key),
) -> dict[str, object]:
    try:
        return service.get(
            workflow_id,
            requester_id=_requester_id(auth),
            is_admin=auth.is_admin,
        ).model_dump(mode="json")
    except KeyError as error:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workflow not found") from error
    except PermissionError as error:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(error)) from error


@router.get("/transformation/{workflow_id}/audit")
def get_business_transformation_audit(
    workflow_id: str,
    auth: AuthContext = Depends(require_api_key),
) -> list[dict[str, object]]:
    try:
        return service.audit(
            workflow_id,
            requester_id=_requester_id(auth),
            is_admin=auth.is_admin,
        )
    except KeyError as error:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workflow not found") from error
    except PermissionError as error:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(error)) from error
