from pydantic import BaseModel


class CurrentUserResponse(BaseModel):
    authenticated: bool = True
    mode: str
    user_id: str | None = None
    role: str | None = None
    is_admin: bool = False
