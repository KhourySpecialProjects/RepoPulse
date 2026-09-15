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
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.deps import get_db_session, require_admin
from app.core.errors import AppError
from app.models.llm_config import LlmConfig
from app.models.llm_token_usage import LlmTokenUsage, current_period
from app.models.user import User
from app.schemas.admin import (
    AdminAttention,
    AdminOverview,
    AdminPipeline,
    LlmUsage,
    RecalculateRequest,
    RecalculateResult,
    RepoSizeSort,
    RepoStorageListResponse,
    StorageSummary,
    SystemStatus,
)
from app.schemas.errors import ErrorResponse
from app.schemas.llm_quota import (
    LlmConfigRead,
    LlmConfigUpdate,
    TokenUsageSummary,
    UserTokenLimitUpdate,
    UserTokenUsage,
    UserTokenUsageListResponse,
)
from app.services.admin_stats_service import AdminStatsService
from app.services.llm.quota import (
    Quota,
    get_llm_config,
    quota_for,
    usage_summary,
)

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


@router.get("/llm-usage", response_model=LlmUsage, responses=_GATED)
async def get_admin_llm_usage(
    days: int = Query(30, ge=1, le=365),
    db: AsyncSession = Depends(get_db_session),
    service: AdminStatsService = Depends(get_admin_stats_service),
) -> LlmUsage:
    """LLM call volume by model, day and collection owner.

    Carries no cost estimate and no failure count: no token counts are
    persisted, and failed calls write no row. Phoenix has the real numbers.
    """
    return await service.llm_usage(db, days=days)


@router.get("/system", response_model=SystemStatus, responses=_GATED)
async def get_admin_system(
    db: AsyncSession = Depends(get_db_session),
    service: AdminStatsService = Depends(get_admin_stats_service),
) -> SystemStatus:
    """Environment and configuration. Secrets reported as booleans only.

    Always 200, even when degraded: authenticating the caller already
    required a successful database read, so this handler cannot be reached
    with a truly unreachable database, and a 503 would make the UI render a
    generic error page in place of the diagnostic.
    """
    return await service.system_status(db)


@router.get("/pipeline", response_model=AdminPipeline, responses=_GATED)
async def get_admin_pipeline(
    db: AsyncSession = Depends(get_db_session),
    service: AdminStatsService = Depends(get_admin_stats_service),
) -> AdminPipeline:
    """Ingestion health and data coverage, as of now.

    Reports health data only as coverage — `unknown` status and a NULL
    health_score, which both mean the scoring pipeline did not run. The
    green/yellow/red spread is an instructor's question and is deliberately
    not served here.

    Takes no window: everything behind it is point-in-time.
    """
    return await service.pipeline(db)


@router.get("/attention", response_model=AdminAttention, responses=_GATED)
async def list_repos_needing_attention(
    limit: int = Query(10, ge=1, le=200),
    offset: int = Query(0, ge=0),
    stale_after_days: int = Query(7, ge=1, le=365),
    db: AsyncSession = Depends(get_db_session),
    service: AdminStatsService = Depends(get_admin_stats_service),
) -> AdminAttention:
    """Repos with an operational fault, worst first.

    Operational only: a repo whose students stopped committing is not here.
    """
    items, total = await service.attention(
        db, limit=limit, offset=offset, stale_after_days=stale_after_days
    )
    return AdminAttention(
        items=items,
        total=total,
        limit=limit,
        offset=offset,
        generated_at=datetime.now(timezone.utc),
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


# ---------------------------------------------------------------------------
# Shared LLM configuration and token limits
# ---------------------------------------------------------------------------
#
# These live behind the admin gate because the instance now talks to one model
# through one key that the operator pays for. A per-user API key field made
# every user their own payer; a shared key makes them all spenders of someone
# else's budget, which is what the token quota meters.


@router.get(
    "/token-usage/summary", response_model=TokenUsageSummary, responses=_GATED
)
async def get_admin_token_usage_summary(
    db: AsyncSession = Depends(get_db_session),
) -> TokenUsageSummary:
    """Instance-wide token spend this month, priced at the configured rates.

    Declared above `/token-usage` only for readability — Starlette matches
    complete paths, so the literal segment cannot be shadowed by the list
    route regardless of order.
    """
    summary = await usage_summary(db)
    return TokenUsageSummary(
        period=summary.period,
        input_tokens=summary.input_tokens,
        output_tokens=summary.output_tokens,
        total_tokens=summary.total_tokens,
        calls=summary.calls,
        models=summary.models,
        input_price_per_mtok=summary.input_price_per_mtok,
        output_price_per_mtok=summary.output_price_per_mtok,
        estimated_cost_usd=summary.estimated_cost_usd,
        mixed_models=len(summary.models) > 1,
    )


def _config_to_read(config: LlmConfig) -> LlmConfigRead:
    return LlmConfigRead(
        id=config.id,
        llm_provider=config.llm_provider,
        llm_model=config.llm_model,
        # A boolean, never the value. Same rule as SystemStatus: a prefix is
        # still a key fragment once it reaches a log aggregator.
        anthropic_api_key_configured=bool(
            config.anthropic_api_key or settings.ANTHROPIC_API_KEY
        ),
        # Distinguishes "working, via .env" from "someone pasted a key here",
        # which is the difference between a healthy default install and an
        # instance nobody has touched.
        anthropic_api_key_from_env=not config.anthropic_api_key
        and bool(settings.ANTHROPIC_API_KEY),
        ollama_base_url=config.ollama_base_url,
        default_monthly_token_limit=config.default_monthly_token_limit,
        input_price_per_mtok=config.input_price_per_mtok,
        output_price_per_mtok=config.output_price_per_mtok,
        updated_at=config.updated_at,
    )


@router.get("/llm-config", response_model=LlmConfigRead, responses=_GATED)
async def get_admin_llm_config(
    db: AsyncSession = Depends(get_db_session),
) -> LlmConfigRead:
    """The model, key and default token allowance every user runs on."""
    return _config_to_read(await get_llm_config(db))


@router.patch("/llm-config", response_model=LlmConfigRead, responses=_GATED)
async def update_admin_llm_config(
    body: LlmConfigUpdate,
    db: AsyncSession = Depends(get_db_session),
) -> LlmConfigRead:
    """Change the instance's LLM configuration.

    `exclude_unset` so an omitted field is untouched, while an explicit null
    clears it — that distinction is what lets an admin remove a wrong API key
    and fall back to ANTHROPIC_API_KEY without also resetting the model.
    """
    config = await get_llm_config(db)

    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(config, field, value)

    await db.commit()
    await db.refresh(config)
    return _config_to_read(config)


def _usage_row(user: User, quota: Quota) -> UserTokenUsage:
    return UserTokenUsage(
        user_id=user.id,
        display_name=user.display_name,
        email=user.email,
        role=user.role,
        used=quota.used,
        limit=quota.limit,
        remaining=quota.remaining,
        unlimited=quota.unlimited,
        exceeded=quota.exceeded,
        override=user.monthly_token_limit,
    )


@router.get(
    "/token-usage", response_model=UserTokenUsageListResponse, responses=_GATED
)
async def list_admin_token_usage(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db_session),
) -> UserTokenUsageListResponse:
    """Every user's spend this month against their effective limit.

    Sorted by spend, heaviest first: the reason to open this page is to find
    who is consuming the budget, not to read an alphabetical roster.
    """
    period = current_period()

    spend = (
        select(
            LlmTokenUsage.user_id.label("user_id"),
            func.sum(LlmTokenUsage.total_tokens).label("used"),
        )
        .where(LlmTokenUsage.period == period)
        .group_by(LlmTokenUsage.user_id)
        .subquery()
    )

    total = int(
        (await db.execute(select(func.count()).select_from(User))).scalar_one()
    )

    # Ordered in SQL over a LEFT JOIN rather than by sorting resolved Quota
    # objects in Python: the limit/offset has to be applied by the database or
    # page 2 would be a different ordering than page 1.
    rows = (
        await db.execute(
            select(User, func.coalesce(spend.c.used, 0).label("used"))
            .outerjoin(spend, spend.c.user_id == User.id)
            .order_by(func.coalesce(spend.c.used, 0).desc(), User.display_name)
            .limit(limit)
            .offset(offset)
        )
    ).all()

    config = await get_llm_config(db)
    items: list[UserTokenUsage] = []
    for user, used in rows:
        # Resolved here rather than via quota_for: that helper re-queries the
        # sum per user, which is one query per row for a page of 50.
        if user.role == "admin":
            effective: int | None = None
        elif user.monthly_token_limit is not None:
            effective = user.monthly_token_limit
        else:
            effective = config.default_monthly_token_limit
        items.append(
            _usage_row(
                user, Quota(period=period, used=int(used), limit=effective)
            )
        )

    return UserTokenUsageListResponse(
        items=items, total=total, limit=limit, offset=offset, period=period
    )


@router.patch(
    "/users/{user_id}/token-limit",
    response_model=UserTokenUsage,
    responses={**_GATED, 404: {"model": ErrorResponse}},
)
async def set_user_token_limit(
    user_id: uuid.UUID,
    body: UserTokenLimitUpdate,
    db: AsyncSession = Depends(get_db_session),
) -> UserTokenUsage:
    """Set or clear one user's monthly allowance.

    A null clears the override so the user follows the instance default; 0
    revokes their AI access outright. Both are deliberate, which is why the
    field is required in the body rather than defaulted.
    """
    user = await db.get(User, user_id)
    if user is None:
        raise AppError(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
            error_code="USER_NOT_FOUND",
        )

    user.monthly_token_limit = body.monthly_token_limit
    await db.commit()
    await db.refresh(user)

    return _usage_row(user, await quota_for(db, user))
