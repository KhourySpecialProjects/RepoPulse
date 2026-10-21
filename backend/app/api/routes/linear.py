from __future__ import annotations

import uuid
from typing import Awaitable, TypeVar

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, get_db_session
from app.core.errors import AppError
from app.models.collection import Collection
from app.models.repo import Repo
from app.models.user import User
from app.schemas.errors import ErrorResponse
from app.schemas.linear import LinearTeamList, RepoLinearResponse, RepoLinearTeamList
from app.services.linear_service import (
    LinearAPIError,
    LinearAuthError,
    LinearService,
    build_repo_linear,
    build_repo_team_summaries,
)
from app.services.permission_service import (
    can_access_collection,
    can_write_collection,
    get_accessible_collection_ids,
)

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


@router.get(
    "/linear/repo-teams",
    response_model=RepoLinearTeamList,
    responses={**_LINEAR_ERRORS, 404: {"model": ErrorResponse}},
)
async def list_linear_repo_teams(
    collection_id: uuid.UUID | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user),
) -> RepoLinearTeamList:
    """The dashboard's Linear box: each of the viewer's repos that has a team.

    Covers what the dashboard covers — the viewer's non-archived collections,
    or the one `collection_id` names — and reads Linear with the viewer's key.
    """
    api_key = await _linear_key(db, current_user_id)
    accessible = await get_accessible_collection_ids(db, uuid.UUID(current_user_id))
    if collection_id is not None and collection_id not in accessible:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Collection not found")

    query = (
        select(Repo)
        .join(Collection, Repo.collection_id == Collection.id)
        .where(
            Repo.collection_id.in_([collection_id] if collection_id else accessible),
            Collection.is_archived == False,  # noqa: E712
        )
    )
    repos = list((await db.execute(query)).scalars().all())

    summaries = await _call_linear(build_repo_team_summaries(repos, api_key))
    return RepoLinearTeamList(
        items=summaries[offset : offset + limit],
        total=len(summaries),
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
