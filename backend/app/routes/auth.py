from fastapi import APIRouter, Depends

from app.schemas.auth import CurrentUserResponse
from app.security import AuthContext, require_api_key


router = APIRouter()


@router.get("/me", response_model=CurrentUserResponse)
def current_user(auth: AuthContext = Depends(require_api_key)) -> CurrentUserResponse:
    return CurrentUserResponse(
        mode=auth.mode,
        user_id=auth.user_id,
        role=auth.role,
        is_admin=auth.is_admin,
    )
