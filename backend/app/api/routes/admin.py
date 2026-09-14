"""Instance-wide administrator endpoints.

The admin gate is declared on the router, not per route. A router where
forgetting a decorator silently exposes instance-wide data is one careless PR
away from a leak; `test_every_admin_route_is_gated` backs this up by failing
if a route appears under /api/v1/admin without a gating test.

Routes stay thin per CLAUDE.md — validate input, call the service, return the
response. All aggregation lives in AdminStatsService.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_db_session, require_admin
from app.schemas.admin import AdminOverview
from app.schemas.errors import ErrorResponse
from app.services.admin_stats_service import AdminStatsService

router = APIRouter(dependencies=[Depends(require_admin)])

_admin_stats_service = AdminStatsService()


def get_admin_stats_service() -> AdminStatsService:
    """Injection seam for the filesystem boundary.

    Later milestones measure clone sizes on disk; tests override this to
    substitute a fake GitService rather than walking a real /repos mount.
    """
    return _admin_stats_service


@router.get(
    "/overview",
    response_model=AdminOverview,
    responses={
        401: {"model": ErrorResponse},
        403: {"model": ErrorResponse},
    },
)
async def get_admin_overview(
    stale_after_days: int = Query(7, ge=1, le=365),
    db: AsyncSession = Depends(get_db_session),
    service: AdminStatsService = Depends(get_admin_stats_service),
) -> AdminOverview:
    """Entity counts, health distribution and sync freshness across the instance."""
    return await service.overview(db, stale_after_days=stale_after_days)
