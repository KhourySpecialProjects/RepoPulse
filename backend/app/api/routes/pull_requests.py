from __future__ import annotations

import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, get_db_session
from app.models.pull_request import PullRequest
from app.models.repo import Repo
from app.models.user import User
from app.schemas.errors import ErrorResponse
from app.services.github_service import GitHubService
from app.services.permission_service import can_access_collection

router = APIRouter()


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------
# hello

class PullRequestRead(BaseModel):
    model_config = ConfigDict(from_attributes=True, protected_namespaces=())

    id: uuid.UUID
    repo_id: uuid.UUID
    pr_number: int
    title: str
    state: str
    author_login: str
    created_at: datetime | None
    merged_at: datetime | None
    closed_at: datetime | None
    html_url: str
    reviews_requested: int
    draft: bool
    fetched_at: datetime


class PRListResponse(BaseModel):
    items: list[PullRequestRead]
    total: int
    limit: int
    offset: int
    fetched_at: datetime | None


class PRStatsResponse(BaseModel):
    open_count: int
    merged_last_30d: int
    avg_days_to_merge: float | None
    total_count: int
    fetched_at: datetime | None


class PRSyncResponse(BaseModel):
    synced: int
    repo_id: str
    fetched_at: str


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _get_repo_or_404(repo_id: uuid.UUID, db: AsyncSession) -> Repo:
    repo = await db.get(Repo, repo_id)
    if repo is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Repo not found")
    return repo


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post(
    "/repos/{repo_id}/pull-requests/sync",
    response_model=PRSyncResponse,
    responses={
        403: {"model": ErrorResponse},
        404: {"model": ErrorResponse},
        502: {"model": ErrorResponse},
    },
)
async def sync_pull_requests(
    repo_id: uuid.UUID,
    db: AsyncSession = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user),
) -> PRSyncResponse:
    """Fetch all PRs from GitHub and upsert into the database."""
    user_uuid = uuid.UUID(current_user_id)

    # Load user and check for github_token
    user = await db.get(User, user_uuid)
    if not user or not user.github_token:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="GitHub token not configured. Add a token in your profile to enable PR sync.",
        )

    repo = await _get_repo_or_404(repo_id, db)

    # Fetch PRs from GitHub
    svc = GitHubService()
    try:
        raw_prs = await svc.fetch_pull_requests(repo.github_url, user.github_token)
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"GitHub API error: {exc}",
        )

    now = datetime.now(timezone.utc)

    if raw_prs:
        rows = []
        for raw in raw_prs:
            parsed = svc.parse_pr(raw)
            rows.append(
                {
                    "id": uuid.uuid4(),
                    "repo_id": repo_id,
                    "fetched_at": now,
                    **parsed,
                }
            )

        stmt = pg_insert(PullRequest).values(rows)
        stmt = stmt.on_conflict_do_update(
            constraint="uq_pull_request_repo_number",
            set_={
                "title": stmt.excluded.title,
                "state": stmt.excluded.state,
                "merged_at": stmt.excluded.merged_at,
                "closed_at": stmt.excluded.closed_at,
                "reviews_requested": stmt.excluded.reviews_requested,
                "draft": stmt.excluded.draft,
                "fetched_at": stmt.excluded.fetched_at,
            },
        )
        await db.execute(stmt)
        await db.commit()

    return PRSyncResponse(
        synced=len(raw_prs),
        repo_id=str(repo_id),
        fetched_at=now.isoformat(),
    )


@router.get(
    "/repos/{repo_id}/pull-requests",
    response_model=PRListResponse,
    responses={404: {"model": ErrorResponse}},
)
async def list_pull_requests(
    repo_id: uuid.UUID,
    state: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user),
) -> PRListResponse:
    """List pull requests for a repo, optionally filtered by state."""
    await _get_repo_or_404(repo_id, db)

    base_where = [PullRequest.repo_id == repo_id]
    if state is not None:
        base_where.append(PullRequest.state == state)

    # Total count
    count_result = await db.execute(
        select(func.count()).select_from(PullRequest).where(*base_where)
    )
    total = count_result.scalar_one()

    # Paginated items ordered by created_at DESC
    items_result = await db.execute(
        select(PullRequest)
        .where(*base_where)
        .order_by(PullRequest.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    items = list(items_result.scalars().all())

    # MAX(fetched_at) for this repo
    fetched_result = await db.execute(
        select(func.max(PullRequest.fetched_at)).where(PullRequest.repo_id == repo_id)
    )
    fetched_at = fetched_result.scalar_one_or_none()

    return PRListResponse(
        items=[PullRequestRead.model_validate(pr) for pr in items],
        total=total,
        limit=limit,
        offset=offset,
        fetched_at=fetched_at,
    )


@router.get(
    "/repos/{repo_id}/pull-requests/stats",
    response_model=PRStatsResponse,
    responses={404: {"model": ErrorResponse}},
)
async def get_pull_request_stats(
    repo_id: uuid.UUID,
    db: AsyncSession = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user),
) -> PRStatsResponse:
    """Return aggregate PR statistics for a repo."""
    await _get_repo_or_404(repo_id, db)

    now = datetime.now(timezone.utc)
    thirty_days_ago = now - timedelta(days=30)

    # open count
    open_result = await db.execute(
        select(func.count())
        .select_from(PullRequest)
        .where(PullRequest.repo_id == repo_id, PullRequest.state == "open")
    )
    open_count = open_result.scalar_one()

    # merged in last 30 days
    merged_30d_result = await db.execute(
        select(func.count())
        .select_from(PullRequest)
        .where(
            PullRequest.repo_id == repo_id,
            PullRequest.state == "merged",
            PullRequest.merged_at > thirty_days_ago,
        )
    )
    merged_last_30d = merged_30d_result.scalar_one()

    # total count
    total_result = await db.execute(
        select(func.count()).select_from(PullRequest).where(PullRequest.repo_id == repo_id)
    )
    total_count = total_result.scalar_one()

    # avg days to merge (for merged PRs with both timestamps)
    avg_result = await db.execute(
        select(
            func.avg(
                func.extract("epoch", PullRequest.merged_at - PullRequest.created_at)
            )
            / 86400
        )
        .select_from(PullRequest)
        .where(
            PullRequest.repo_id == repo_id,
            PullRequest.state == "merged",
            PullRequest.merged_at.is_not(None),
            PullRequest.created_at.is_not(None),
        )
    )
    avg_days_raw = avg_result.scalar_one_or_none()
    avg_days_to_merge = float(avg_days_raw) if avg_days_raw is not None else None

    # max fetched_at
    fetched_result = await db.execute(
        select(func.max(PullRequest.fetched_at)).where(PullRequest.repo_id == repo_id)
    )
    fetched_at = fetched_result.scalar_one_or_none()

    return PRStatsResponse(
        open_count=open_count,
        merged_last_30d=merged_last_30d,
        avg_days_to_merge=avg_days_to_merge,
        total_count=total_count,
        fetched_at=fetched_at,
    )
