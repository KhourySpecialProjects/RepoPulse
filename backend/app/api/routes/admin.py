"""Instance-wide administrator endpoints.

The admin gate is declared on the router, not per route. A router where
forgetting a decorator silently exposes instance-wide data is one careless PR
away from a leak; `test_every_admin_route_is_gated` backs this up by failing
if a route appears under /api/v1/admin without a gating test.

Routes stay thin per CLAUDE.md — validate input, call the service, return the
response. All aggregation lives in AdminStatsService.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_db_session, require_admin
from app.schemas.admin import (
    AdminOverview,
    RecalculateRequest,
    RecalculateResult,
    RepoSizeSort,
    RepoStorageListResponse,
    StorageSummary,
)
from app.schemas.errors import ErrorResponse
from app.services.admin_stats_service import AdminStatsService

_GATED = {
    401: {"model": ErrorResponse},
    403: {"model": ErrorResponse},
}

router = APIRouter(dependencies=[Depends(require_admin)])

_admin_stats_service = AdminStatsService()


def get_admin_stats_service() -> AdminStatsService:
    """Injection seam for the filesystem boundary.

    Later milestones measure clone sizes on disk; tests override this to
    substitute a fake GitService rather than walking a real /repos mount.
    """
    return _admin_stats_service


@router.get("/overview", response_model=AdminOverview, responses=_GATED)
async def get_admin_overview(
    stale_after_days: int = Query(7, ge=1, le=365),
    db: AsyncSession = Depends(get_db_session),
    service: AdminStatsService = Depends(get_admin_stats_service),
) -> AdminOverview:
    """Entity counts, health distribution and sync freshness across the instance."""
    return await service.overview(db, stale_after_days=stale_after_days)


@router.get("/storage", response_model=StorageSummary, responses=_GATED)
async def get_admin_storage(
    include_orphan_size: bool = Query(
        False,
        description=(
            "Walk orphaned clone directories to size them. Off by default: "
            "one abandoned multi-gigabyte clone would stall the request."
        ),
    ),
    db: AsyncSession = Depends(get_db_session),
    service: AdminStatsService = Depends(get_admin_stats_service),
) -> StorageSummary:
    """Disk, database and clone storage, plus drift between disk and database."""
    return await service.storage_summary(
        db, include_orphan_size=include_orphan_size
    )


@router.get(
    "/storage/repos", response_model=RepoStorageListResponse, responses=_GATED
)
async def list_repo_storage(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    sort: RepoSizeSort = Query("size_desc"),
    collection_id: uuid.UUID | None = Query(None),
    db: AsyncSession = Depends(get_db_session),
    service: AdminStatsService = Depends(get_admin_stats_service),
) -> RepoStorageListResponse:
    """Per-repo sizes, largest first, with never-measured repos last."""
    items, total = await service.repo_sizes(
        db, limit=limit, offset=offset, sort=sort, collection_id=collection_id
    )
    return RepoStorageListResponse(
        items=items, total=total, limit=limit, offset=offset
    )


@router.post(
    "/storage/recalculate",
    response_model=RecalculateResult,
    responses={**_GATED, 400: {"model": ErrorResponse}},
)
async def recalculate_repo_storage(
    body: RecalculateRequest | None = None,
    db: AsyncSession = Depends(get_db_session),
    service: AdminStatsService = Depends(get_admin_stats_service),
) -> RecalculateResult:
    """Re-measure clone sizes on disk and persist them.

    Synchronous: the walk is bounded at the PRD's repo scale, and a 202 with
    a job id nothing can poll would be strictly worse than a 200 that is done.
    """
    return await service.recalculate_repo_sizes(
        db,
        repo_ids=body.repo_ids if body else None,
        collection_id=body.collection_id if body else None,
    )
