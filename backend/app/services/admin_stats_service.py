"""Instance-wide aggregates for the administrator dashboard.

Deliberately unscoped. No method here takes a caller identity, which is the
structural guarantee that an admin sees the whole installation rather than
their own permission scope — there is no parameter through which scoping could
leak in. `test_no_aggregate_method_accepts_a_user_id` enforces it.

Aggregation happens in SQL, not by fanning out in Python. The frontend
DashboardPage builds its totals with a request per collection and then per
repo; that is O(collections x pages) round trips and only ever sees the
caller's accessible collections. An admin view is instance-wide by definition,
so it is computed in one place with one query each.

Postgres-specific SQL is used freely — CLAUDE.md permits it ("it is already
PostgreSQL"), and `count(*) FILTER (...)` and `make_interval` have no portable
equivalent worth the loss of clarity.
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.repo import Repo
from app.schemas.admin import (
    AdminOverview,
    EntityCounts,
    HealthDistribution,
    SyncFreshness,
)
from app.services.git_service import GitService

_HEALTH_STATUSES = ("green", "yellow", "red", "unknown")

# One round trip. Scalar subqueries rather than a UNION so the result is a
# single row that maps straight onto EntityCounts.
_ENTITY_COUNTS_SQL = text(
    """
    SELECT
      (SELECT count(*) FROM users)                           AS users,
      (SELECT count(*) FROM users WHERE role = 'admin')      AS admins,
      (SELECT count(*) FROM users WHERE role = 'instructor') AS instructors,
      (SELECT count(*) FROM users WHERE role = 'ta')         AS tas,
      (SELECT count(*) FROM collections)                     AS collections,
      (SELECT count(*) FROM collections WHERE is_archived)   AS archived_collections,
      (SELECT count(*) FROM repos)                           AS repos,
      (SELECT count(*) FROM contributors)                    AS contributors,
      (SELECT count(*) FROM notes)                           AS notes,
      (SELECT count(*) FROM note_comments)                   AS note_comments,
      (SELECT count(*) FROM summaries)                       AS summaries,
      (SELECT count(*) FROM commit_classifications)          AS commit_classifications,
      (SELECT count(*) FROM pull_requests)                   AS pull_requests,
      (SELECT count(*) FROM notifications)                   AS notifications,
      (SELECT count(*) FROM collection_access)               AS collection_access
    """
)

# make_interval(days => :days) rather than a concatenated INTERVAL literal, so
# the window is a bound parameter and never string-interpolated.
_SYNC_FRESHNESS_SQL = text(
    """
    SELECT
      count(*)                                                                       AS total,
      count(*) FILTER (WHERE last_synced_at IS NULL)                                 AS never_synced,
      count(*) FILTER (WHERE last_synced_at <  now() - make_interval(days => :days))  AS stale,
      count(*) FILTER (WHERE last_synced_at >= now() - make_interval(days => :days))  AS fresh,
      max(last_synced_at)                                                            AS most_recent_sync,
      min(last_synced_at)                                                            AS oldest_sync
    FROM repos
    """
)


class AdminStatsService:
    """SQL aggregates for the admin dashboard.

    Takes a GitService so the filesystem boundary is injectable: later
    milestones measure clone sizes, and tests must be able to substitute a
    fake rather than walking a real /repos mount.
    """

    def __init__(self, git_service: GitService | None = None) -> None:
        self._git = git_service or GitService()

    async def entity_counts(self, db: AsyncSession) -> EntityCounts:
        row = (await db.execute(_ENTITY_COUNTS_SQL)).mappings().one()
        return EntityCounts(**row)

    async def health_distribution(self, db: AsyncSession) -> HealthDistribution:
        rows = (
            await db.execute(
                select(Repo.health_status, func.count()).group_by(Repo.health_status)
            )
        ).all()
        # Zero-fill first so an absent status serialises as 0 rather than
        # vanishing from the response and breaking the chart.
        counts = {status: 0 for status in _HEALTH_STATUSES}
        for status, count in rows:
            if status in counts:
                counts[status] = count
        return HealthDistribution(**counts)

    async def sync_freshness(
        self, db: AsyncSession, *, stale_after_days: int = 7
    ) -> SyncFreshness:
        row = (
            (await db.execute(_SYNC_FRESHNESS_SQL, {"days": stale_after_days}))
            .mappings()
            .one()
        )
        return SyncFreshness(stale_after_days=stale_after_days, **row)

    async def overview(
        self, db: AsyncSession, *, stale_after_days: int = 7
    ) -> AdminOverview:
        return AdminOverview(
            counts=await self.entity_counts(db),
            health=await self.health_distribution(db),
            sync=await self.sync_freshness(db, stale_after_days=stale_after_days),
            generated_at=datetime.now(timezone.utc),
        )
