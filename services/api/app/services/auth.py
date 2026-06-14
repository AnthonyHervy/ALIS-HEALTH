import hashlib
import secrets
from datetime import datetime

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.models import HealthDeviceToken, HealthUser


def hash_token(secret_key: str, token: str) -> str:
    return hashlib.sha256(f"{secret_key}:{token}".encode("utf-8")).hexdigest()


class AuthService:
    def __init__(self, db: AsyncSession, settings: Settings):
        self.db = db
        self.settings = settings

    async def register_device(self, pairing_code: str, device_name: str | None) -> tuple[str, str]:
        if pairing_code != self.settings.pairing_code:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid pairing code",
            )

        result = await self.db.execute(select(HealthUser).limit(1))
        user = result.scalar_one_or_none()
        if user is None:
            user = HealthUser()
            self.db.add(user)
            await self.db.flush()

        token = secrets.token_urlsafe(32)
        self.db.add(
            HealthDeviceToken(
                user_id=user.id,
                token_hash=hash_token(self.settings.secret_key, token),
                device_name=device_name,
            )
        )
        await self.db.commit()
        return user.id, token

    async def validate_token(self, token: str) -> HealthUser:
        token_hash = hash_token(self.settings.secret_key, token)
        result = await self.db.execute(
            select(HealthDeviceToken, HealthUser)
            .join(HealthUser, HealthUser.id == HealthDeviceToken.user_id)
            .where(
                HealthDeviceToken.token_hash == token_hash,
                HealthDeviceToken.revoked.is_(False),
            )
        )
        row = result.first()
        if row is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid device token",
            )
        return row[1]

    async def revoke_token(self, token: str) -> None:
        token_hash = hash_token(self.settings.secret_key, token)
        result = await self.db.execute(
            select(HealthDeviceToken).where(
                HealthDeviceToken.token_hash == token_hash,
                HealthDeviceToken.revoked.is_(False),
            )
        )
        device_token = result.scalar_one_or_none()
        if device_token is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid device token",
            )
        device_token.revoked = True
        device_token.revoked_at = datetime.utcnow()
        await self.db.commit()

    async def rotate_token(self, token: str, user_id: str) -> tuple[str, str]:
        token_hash = hash_token(self.settings.secret_key, token)
        result = await self.db.execute(
            select(HealthDeviceToken).where(
                HealthDeviceToken.token_hash == token_hash,
                HealthDeviceToken.user_id == user_id,
                HealthDeviceToken.revoked.is_(False),
            )
        )
        device_token = result.scalar_one_or_none()
        if device_token is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid device token",
            )

        device_token.revoked = True
        device_token.revoked_at = datetime.utcnow()
        replacement = secrets.token_urlsafe(32)
        self.db.add(
            HealthDeviceToken(
                user_id=user_id,
                token_hash=hash_token(self.settings.secret_key, replacement),
                device_name=device_token.device_name,
            )
        )
        await self.db.commit()
        return user_id, replacement
