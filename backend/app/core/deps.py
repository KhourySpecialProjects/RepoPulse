from __future__ import annotations

import uuid
from typing import AsyncGenerator

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import verify_token
from app.db.database import get_db
from app.models.user import User

# auto_error=False so a missing Authorization header reaches get_current_user
# and can be answered with 401. 
security = HTTPBearer(auto_error=False)


async def get_db_session() -> AsyncGenerator[AsyncSession, None]:
    async for session in get_db():
        yield session


# Alias so routes can use get_db from deps
get_db = get_db


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
) -> str:
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    token = credentials.credentials
    payload = verify_token(token)
    if payload is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    user_id: str | None = payload.get("sub")
    if user_id is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token missing subject claim",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user_id


async def resolve_user(db: AsyncSession, subject: str) -> User | None:
    """Turn a JWT `sub` into a User row.

    Returns None for a malformed or unknown subject rather than raising, so
    callers choose the status code. Route modules currently inline
    `uuid.UUID(current_user_id)`, which raises ValueError on a malformed
    subject and surfaces as a 500.
    """
    try:
        user_uuid = uuid.UUID(subject)
    except (ValueError, AttributeError, TypeError):
        return None
    return await db.get(User, user_uuid)


async def get_current_user_obj(
    current_user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> User:
    """The authenticated User row, not just the `sub` string.

    Depends on get_db_session by identity, which is the object the test suite
    overrides, so dependency_overrides propagate here with no extra wiring.
    """
    user = await resolve_user(db, current_user_id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User no longer exists",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


async def require_admin(user: User = Depends(get_current_user_obj)) -> User:
    """FastAPI dependency gating instance-wide admin routes.

    401 when unauthenticated (from get_current_user_obj), 403 when the caller
    is authenticated but not an administrator.
    """
    if user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden"
        )
    return user


async def require_admin_user(db: AsyncSession, subject: str) -> User:
    """Plain-async admin gate, shared with users._require_admin.

    Not a FastAPI dependency — it takes the session and subject explicitly so
    the existing users.py call sites can delegate unchanged.

    Deliberately 403 (not 401) for an unknown or malformed subject. That
    matches what users._require_admin already returns at its four call sites;
    diverging would move existing tests for no benefit.
    """
    me = await resolve_user(db, subject)
    if me is None or me.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden"
        )
    return me
