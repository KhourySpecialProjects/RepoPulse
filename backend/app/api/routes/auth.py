from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import create_access_token
from app.core.config import settings
from app.core.deps import get_db_session
from app.models.user import User
from app.schemas.auth import (
    CompleteSetupRequest,
    DevLoginRequest,
    LoginRequest,
    SetupTokenInfo,
    TokenResponse,
    VerifySetupTokenRequest,
)
from app.schemas.errors import ErrorResponse
from app.services.account_setup_service import complete_setup, resolve_setup_token

router = APIRouter()


@router.post(
    "/login",
    response_model=TokenResponse,
    responses={401: {"model": ErrorResponse}},
)
async def login(
    body: LoginRequest,
    db: AsyncSession = Depends(get_db_session),
) -> TokenResponse:
    """Production login via email and password."""
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()

    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # In prod mode, verify password hash
    if user.password_hash is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        from passlib.context import CryptContext

        pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
        if not pwd_context.verify(body.password, user.password_hash):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid email or password",
                headers={"WWW-Authenticate": "Bearer"},
            )
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = create_access_token({"sub": str(user.id)})
    return TokenResponse(
        access_token=token,
        token_type="bearer",
        user_id=str(user.id),
        display_name=user.display_name,
        role=user.role,
    )


@router.post(
    "/dev-login",
    response_model=TokenResponse,
    responses={
        403: {"model": ErrorResponse},
        404: {"model": ErrorResponse},
    },
)
async def dev_login(
    body: DevLoginRequest,
    db: AsyncSession = Depends(get_db_session),
) -> TokenResponse:
    """Development-only login: accepts a user_id without password."""
    if settings.AUTH_MODE != "dev":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Dev login is disabled in production mode",
        )

    try:
        user_uuid = uuid.UUID(body.user_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"User {body.user_id!r} not found",
        )

    user = await db.get(User, user_uuid)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"User {body.user_id!r} not found",
        )

    token = create_access_token({"sub": str(user.id)})
    return TokenResponse(
        access_token=token,
        token_type="bearer",
        user_id=str(user.id),
        display_name=user.display_name,
        role=user.role,
    )


# ---------------------------------------------------------------------------
# Account setup links
#
# Both routes are public by necessity — the caller is someone who has no
# credentials yet, which is the whole point of the link. Authority comes from
# holding the token, which `resolve_setup_token` checks.
#
# They answer 400, never 401, on a bad token. The frontend api client redirects
# to /login on any 401, which would throw the user off the setup page before
# they could read what went wrong.
# ---------------------------------------------------------------------------


@router.post(
    "/account-setup/verify",
    response_model=SetupTokenInfo,
    responses={400: {"model": ErrorResponse}},
)
async def verify_account_setup_token(
    body: VerifySetupTokenRequest,
    db: AsyncSession = Depends(get_db_session),
) -> SetupTokenInfo:
    """Check a setup link and report who it is for, without spending it."""
    token = await resolve_setup_token(db, body.token)
    user = token.user
    return SetupTokenInfo(
        email=user.email,
        display_name=user.display_name,
        expires_at=token.expires_at,
    )


@router.post(
    "/account-setup/complete",
    response_model=TokenResponse,
    responses={400: {"model": ErrorResponse}},
)
async def complete_account_setup(
    body: CompleteSetupRequest,
    db: AsyncSession = Depends(get_db_session),
) -> TokenResponse:
    """Set the password chosen by the link's recipient and sign them in.

    Returning a session token saves sending someone who has just chosen a
    password to a login form to type it again. A GitHub token, if the
    recipient supplied one, is stored on their account and never echoed back.
    """
    user = await complete_setup(
        db, body.token, body.new_password, body.github_token
    )
    return TokenResponse(
        access_token=create_access_token({"sub": str(user.id)}),
        token_type="bearer",
        user_id=str(user.id),
        display_name=user.display_name,
        role=user.role,
    )
