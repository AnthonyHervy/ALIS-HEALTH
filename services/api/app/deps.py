from fastapi import Depends, Header, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.models import HealthUser
from app.services.auth import AuthService


def get_settings(request: Request):
    return request.app.state.settings


def extract_bearer_token(authorization: str | None) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing device token")
    return authorization.split(" ", 1)[1].strip()


async def current_user(
    request: Request,
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_session),
) -> HealthUser:
    token = extract_bearer_token(authorization)
    return await AuthService(db, request.app.state.settings).validate_token(token)


async def current_token(authorization: str | None = Header(default=None)) -> str:
    return extract_bearer_token(authorization)
