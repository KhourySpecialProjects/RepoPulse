from __future__ import annotations

import uuid
from typing import Awaitable, TypeVar

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, get_db_session
from app.core.errors import AppError
from app.models.repo import Repo
from app.models.user import User
from app.schemas.errors import ErrorResponse
from app.schemas.linear import LinearProjectList, LinearTeamList, RepoLinearResponse
from app.services.linear_service import (
    LinearAPIError,
    LinearAuthError,
    LinearService,
    build_repo_linear,
)
from app.services.permission_service import can_access_collection, can_write_collection

router = APIRouter()

T = TypeVar("T")

_LINEAR_ERRORS = {
    400: {"model": ErrorResponse},
    401: {"model": ErrorResponse},
    502: {"model": ErrorResponse},
}


async def _call_linear(awaitable: Awaitable[T]) -> T:
    """Translate Linear failures into the error envelope.

    400 rather than 401 for a rejected key: the RepoPulse session is fine, and
    the frontend treats a 401 as "signed out".
    """
    try:
        return await awaitable
    except LinearAuthError:
        raise AppError(
            status.HTTP_400_BAD_REQUEST,
            "Linear rejected your API key. Update it in Settings.",
            "linear_key_invalid",
        )
    except LinearAPIError:
        raise AppError(
            status.HTTP_502_BAD_GATEWAY,
            "Linear could not be reached. Try again shortly.",
            "linear_unavailable",
        )


async def _linear_key(db: AsyncSession, current_user_id: str) -> str:
    """The current user's Linear key, or the not-configured error."""
    user = await db.get(User, uuid.UUID(current_user_id))
    if user is None or not user.linear_api_key:
        raise AppError(
            status.HTTP_400_BAD_REQUEST,
            "Linear API key not configured. Add one in Settings.",
            "linear_not_configured",
        )
    return user.linear_api_key


@router.get("/linear/teams", response_model=LinearTeamList, responses=_LINEAR_ERRORS)
async def list_linear_teams(
    limit: int = Query(default=100, ge=1, le=250),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user),
) -> LinearTeamList:
    """Teams visible to the current user's Linear key, for the team picker."""
    api_key = await _linear_key(db, current_user_id)
    teams = await _call_linear(LinearService(api_key).list_teams())
    teams.sort(key=lambda t: t.name.lower())
    return LinearTeamList(
        items=[t.to_read() for t in teams[offset : offset + limit]],
        total=len(teams),
        limit=limit,
        offset=offset,
    )


@router.get("/linear/projects", response_model=LinearProjectList, responses=_LINEAR_ERRORS)
async def list_linear_projects(
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user),
) -> LinearProjectList:
    """Projects across the current user's Linear workspace, for the dashboard."""
    api_key = await _linear_key(db, current_user_id)
    projects = await _call_linear(LinearService(api_key).list_projects())
    return LinearProjectList(
        items=projects[offset : offset + limit],
        total=len(projects),
        limit=limit,
        offset=offset,
    )


@router.get(
    "/repos/{repo_id}/linear",
    response_model=RepoLinearResponse,
    responses={**_LINEAR_ERRORS, 404: {"model": ErrorResponse}},
)
async def get_repo_linear(
    repo_id: uuid.UUID,
    db: AsyncSession = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user),
) -> RepoLinearResponse:
    """Linear stats for the repo's team, read live with the viewer's key."""
    user_uuid = uuid.UUID(current_user_id)
    repo = await db.get(Repo, repo_id)
    if repo is None or not await can_access_collection(db, user_uuid, repo.collection_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Repo not found")

    user = await db.get(User, user_uuid)
    return await _call_linear(
        build_repo_linear(
            repo,
            user.linear_api_key if user else None,
            can_change_team=await can_write_collection(db, user_uuid, repo.collection_id),
        )
    )
