from dataclasses import dataclass

from fastapi import Header, HTTPException, Request, status
from sqlalchemy import text

from app.core_config import get_settings
from app.db import get_session_factory

try:
    from jwt import InvalidTokenError, decode
except ImportError:  # pragma: no cover - dependency is installed in production requirements
    InvalidTokenError = ValueError
    decode = None


@dataclass(frozen=True)
class AuthContext:
    mode: str
    user_id: str | None = None
    role: str | None = None
    is_admin: bool = False


def require_api_key(
    request: Request,
    x_api_key: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> AuthContext:
    settings = get_settings()
    client_host = request.client.host if request.client else ""
    local_client = client_host in {"127.0.0.1", "::1", "localhost", "testclient"}
    if (
        not settings.app_api_key
        and settings.environment != "production"
        and settings.allow_insecure_local_auth
        and local_client
    ):
        return AuthContext(mode="local", role="admin", is_admin=True)

    if settings.app_api_key and x_api_key == settings.app_api_key:
        return AuthContext(mode="api_key", role="service", is_admin=True)

    if authorization and settings.supabase_jwt_secret and settings.database_url:
        return _require_approved_supabase_user(authorization, settings.supabase_jwt_secret)

    if not settings.app_api_key and not settings.supabase_jwt_secret:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="APP_API_KEY or SUPABASE_JWT_SECRET is required for protected endpoints",
        )

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or missing API key or Supabase session",
    )


def _require_approved_supabase_user(authorization: str, jwt_secret: str) -> AuthContext:
    if decode is None:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="PyJWT is required for Supabase auth")

    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid authorization header")

    try:
        claims = decode(
            token,
            jwt_secret,
            algorithms=["HS256"],
            audience="authenticated",
        )
    except InvalidTokenError as error:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid Supabase session") from error

    user_id = claims.get("sub")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid Supabase user")

    session_factory = get_session_factory()
    with session_factory() as session:
        profile = session.execute(
            text("select approved, role from public.profiles where id = :user_id"),
            {"user_id": user_id},
        ).mappings().one_or_none()

    if profile is None or profile["approved"] is not True:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Supabase user is not approved")

    role = str(profile["role"])
    return AuthContext(
        mode="supabase",
        user_id=str(user_id),
        role=role,
        is_admin=role == "admin",
    )
