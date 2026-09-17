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

import asyncio
import os
import shutil
import time
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.database import Base
from app.models.repo import Repo
from app.schemas.admin import (
    AdminAttention,
    AdminOverview,
    AdminPipeline,
    AgeBucket,
    AttentionReason,
    AttentionRepo,
    CloneStorage,
    CoverageGap,
    DiskUsage,
    DriftItem,
    EntityCounts,
    HealthDistribution,
    LlmDailyUsage,
    LlmModelUsage,
    LlmUsage,
    RecalculateResult,
    RepoSizeSort,
    RepoStorageItem,
    StorageDrift,
    StorageSummary,
    SyncErrorGroup,
    SyncFreshness,
    SyncStateCounts,
    SystemStatus,
    TableStat,
)
from app.services.git_service import GitService
from app.services.llm.quota import get_llm_config
from app.services.system_status_service import head_revision, probe_schema

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

_TABLE_BYTES_SQL = text(
    """
    SELECT
        c.relname                     AS table_name,
        pg_total_relation_size(c.oid) AS total_bytes,
        pg_table_size(c.oid)          AS table_bytes,
        pg_indexes_size(c.oid)        AS index_bytes,
        COALESCE(s.n_live_tup, 0)     AS row_estimate
    FROM pg_class c
    JOIN pg_namespace n             ON n.oid   = c.relnamespace
    LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
    WHERE n.nspname = 'public' AND c.relkind = 'r'
    ORDER BY pg_total_relation_size(c.oid) DESC
    """
)

_CLONE_TOTALS_SQL = text(
    """
    SELECT
      count(*) FILTER (WHERE size_bytes IS NOT NULL)     AS measured_repos,
      count(*) FILTER (WHERE size_bytes IS NULL)         AS unmeasured_repos,
      COALESCE(sum(size_bytes), 0)                       AS total_bytes,
      COALESCE(sum(git_size_bytes), 0)                   AS git_bytes,
      min(size_computed_at)                              AS oldest_measurement,
      max(size_computed_at)                              AS newest_measurement
    FROM repos
    """
)

# Fixed fragments selected by a Literal, never interpolated from input.
# NULLS LAST keeps never-measured repos at the bottom of a size view; the
# name tiebreak is not cosmetic — without it LIMIT/OFFSET over equal sizes
# can repeat or skip rows across pages.
_REPO_SORTS: dict[str, str] = {
    "size_desc": "r.size_bytes DESC NULLS LAST, r.name ASC",
    "size_asc": "r.size_bytes ASC NULLS LAST, r.name ASC",
    "name_asc": "r.name ASC",
    "measured_asc": "r.size_computed_at ASC NULLS FIRST, r.name ASC",
}

# How many clones to walk at once during a recalculate. Each walk is already
# off-thread; four in flight saturates a disk without thrashing it.
_RECALC_CONCURRENCY = 4

# Call volume comes from llm_token_usage, the only table that records provider
# requests. It previously came from a union over `summaries` and
# `commit_classifications`, which are one-per-artefact: a 222-commit Classify
# run reported 222 calls against the six batched requests it actually made, and
# the number moved with repo size rather than with load. It also could not see
# commit-quality scoring at all, so the graph's series summed to less than its
# own total.
#
# SUM(calls) rather than count(*) for the same reason one level down: a row is
# one write, and a batching caller settles a whole wave in one write.
#
# created_at is timestamptz here, so no AT TIME ZONE reification is needed —
# unlike commit_classifications.scored_at, which is naive and was the reason
# the old query carried a cast.
_LLM_BY_MODEL_SQL = text(
    """
    SELECT feature AS kind,
           model_used AS model,
           SUM(calls) AS calls,
           MIN(created_at) AS first_at,
           MAX(created_at) AS last_at
    FROM llm_token_usage
    WHERE created_at >= now() - make_interval(days => :days)
    GROUP BY feature, model_used
    -- Ordered by the aggregate and the real column, not by the output aliases:
    -- `calls` names both the summed alias and the column it sums, and leaving
    -- Postgres to pick between them is not worth the ambiguity.
    ORDER BY SUM(calls) DESC, model_used ASC
    """
)

_LLM_DAILY_SQL = text(
    """
    SELECT CAST(created_at AT TIME ZONE 'UTC' AS date) AS day,
           feature AS kind,
           SUM(calls) AS calls
    FROM llm_token_usage
    WHERE created_at >= now() - make_interval(days => :days)
    GROUP BY 1, 2
    ORDER BY 1, 2
    """
)


# ---------------------------------------------------------------------------
# Pipeline health
#
# Health data appears here only as coverage — `unknown` status and a NULL
# health_score, both of which mean "the scoring pipeline did not run". The
# green/yellow/red spread is deliberately absent: that is an instructor's
# question, and answering it here would turn an operations dashboard into a
# gradebook.
# ---------------------------------------------------------------------------

_SYNC_STATE_SQL = text(
    """
    SELECT
      count(*) FILTER (WHERE sync_status = 'idle')    AS idle,
      count(*) FILTER (WHERE sync_status = 'syncing') AS syncing,
      count(*) FILTER (WHERE sync_status = 'failed')  AS failed
    FROM repos
    """
)

# Only currently-failing repos. A sync_error left behind on a repo that has
# since succeeded is history, and reporting it would keep a fixed fault on the
# dashboard forever.
#
# Ordered by size so the systemic fault leads: twelve repos sharing one error
# is one thing to fix, and it should not sit below a one-off.
_SYNC_ERROR_GROUPS_SQL = text(
    """
    SELECT
      sync_error                 AS error,
      count(*)                   AS repos,
      min(name)                  AS example_repo_name,
      max(last_synced_at)        AS last_seen
    FROM repos
    WHERE sync_status = 'failed' AND sync_error IS NOT NULL
    GROUP BY sync_error
    ORDER BY count(*) DESC, sync_error ASC
    """
)

# Half-open intervals, so the buckets partition the fleet: every repo lands in
# exactly one and the column heights sum to the repo count.
_SYNC_AGE_SQL = text(
    """
    SELECT
      count(*) FILTER (
        WHERE last_synced_at >= now() - make_interval(days => 1)
      ) AS lt1d,
      count(*) FILTER (
        WHERE last_synced_at <  now() - make_interval(days => 1)
          AND last_synced_at >= now() - make_interval(days => 3)
      ) AS "1to3d",
      count(*) FILTER (
        WHERE last_synced_at <  now() - make_interval(days => 3)
          AND last_synced_at >= now() - make_interval(days => 7)
      ) AS "3to7d",
      count(*) FILTER (
        WHERE last_synced_at <  now() - make_interval(days => 7)
          AND last_synced_at >= now() - make_interval(days => 30)
      ) AS "7to30d",
      count(*) FILTER (
        WHERE last_synced_at <  now() - make_interval(days => 30)
      ) AS "gt30d",
      count(*) FILTER (WHERE last_synced_at IS NULL) AS never
    FROM repos
    """
)

_AGE_BUCKET_LABELS: tuple[tuple[str, str], ...] = (
    ("lt1d", "Under a day"),
    ("1to3d", "1-3 days"),
    ("3to7d", "3-7 days"),
    ("7to30d", "7-30 days"),
    ("gt30d", "Over 30 days"),
    ("never", "Never synced"),
)

# size_bytes IS NULL is "never measured"; 0 is a real measurement of an empty
# clone. Conflating them would report a working measurement pass as a gap.
_COVERAGE_SQL = text(
    """
    SELECT
      count(*)                                        AS repos,
      count(*) FILTER (WHERE health_score IS NULL)     AS no_health_score,
      count(*) FILTER (WHERE health_status = 'unknown') AS unknown_health,
      count(*) FILTER (WHERE size_bytes IS NULL)       AS unmeasured_clone
    FROM repos
    """
)

_UNATTRIBUTED_SUMMARY_SQL = text(
    """
    SELECT
      count(*)                                  AS summaries,
      count(*) FILTER (WHERE repo_id IS NULL)   AS unattributed
    FROM summaries
    """
)

# ---------------------------------------------------------------------------
# Attention
# ---------------------------------------------------------------------------

_ATTENTION_REPOS_SQL = text(
    """
    SELECT
      r.id, r.name, r.collection_id, c.name AS collection_name,
      r.sync_status, r.sync_error, r.last_synced_at, r.local_path,
      r.size_bytes, r.health_score
    FROM repos r
    JOIN collections c ON c.id = r.collection_id
    ORDER BY r.name ASC
    """
)

# Weights, not a flat count: a repo whose clone has vanished or whose sync is
# erroring is actionable now, while a missing measurement is housekeeping.
# Ordering by fault count alone would float five cosmetic gaps above one
# outage.
_ATTENTION_WEIGHTS: dict[str, int] = {
    "sync_failed": 5,
    "clone_missing": 4,
    "never_synced": 3,
    "stale_sync": 2,
    "no_health_data": 1,
    "unmeasured": 1,
}

_ATTENTION_LABELS: dict[str, str] = {
    "sync_failed": "Last sync failed",
    "clone_missing": "No files on disk",
    "never_synced": "Never synced",
    "stale_sync": "Sync is stale",
    "no_health_data": "No health score",
    "unmeasured": "Clone size never measured",
}


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
        # Named health_status, not status: `status` is fastapi's status module
        # at this scope, and shadowing it here would be a trap for whoever
        # next needs a status code in this method.
        counts = {name: 0 for name in _HEALTH_STATUSES}
        for health_status, count in rows:
            if health_status in counts:
                counts[health_status] = count
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

    # ------------------------------------------------------------------
    # Storage
    # ------------------------------------------------------------------

    async def database_size(self, db: AsyncSession) -> int:
        return int(
            (await db.execute(text("SELECT pg_database_size(current_database())")))
            .scalar_one()
        )

    async def _exact_row_counts(self, db: AsyncSession) -> dict[str, int]:
        """count(*) per table.

        Interpolating the table names is safe here and nowhere else: they come
        from Base.metadata, a closed set defined in code, never from a request.
        Needed because pg_stat_user_tables.n_live_tup is an autovacuum estimate
        that reads 0 right after inserts — wrong on a freshly seeded instance,
        which is exactly when an admin first looks.
        """
        names = [table.name for table in Base.metadata.sorted_tables]
        if not names:
            return {}
        union = " UNION ALL ".join(
            f"SELECT '{name}' AS table_name, count(*) AS row_count FROM {name}"
            for name in names
        )
        rows = (await db.execute(text(union))).mappings().all()
        return {row["table_name"]: int(row["row_count"]) for row in rows}

    async def table_stats(
        self, db: AsyncSession, *, exact_counts: bool = True
    ) -> list[TableStat]:
        rows = (await db.execute(_TABLE_BYTES_SQL)).mappings().all()
        exact = await self._exact_row_counts(db) if exact_counts else {}
        return [
            TableStat(
                table_name=row["table_name"],
                total_bytes=row["total_bytes"],
                table_bytes=row["table_bytes"],
                index_bytes=row["index_bytes"],
                row_estimate=row["row_estimate"],
                # Tables outside Base.metadata (alembic_version) have no exact
                # count; fall back rather than omitting the row.
                row_count=exact.get(row["table_name"], row["row_estimate"]),
            )
            for row in rows
        ]

    async def disk_usage(self, root: str | None = None) -> DiskUsage:
        """Free space on the volume holding the clones.

        A single statvfs call, not a walk, so it does not go through
        GitService and does not need a thread.
        """
        target = root or settings.REPO_ROOT_DIR
        try:
            usage = shutil.disk_usage(target)
        except (FileNotFoundError, NotADirectoryError, PermissionError):
            # An unmounted repo root reports as absent rather than as zero
            # bytes used, which would read as a healthy empty disk.
            return DiskUsage(
                root=target,
                exists=False,
                total_bytes=0,
                used_bytes=0,
                free_bytes=0,
                percent_used=0.0,
            )
        return DiskUsage(
            root=target,
            exists=True,
            total_bytes=usage.total,
            used_bytes=usage.used,
            free_bytes=usage.free,
            percent_used=(usage.used / usage.total * 100) if usage.total else 0.0,
        )

    async def clone_storage(self, db: AsyncSession) -> CloneStorage:
        row = (await db.execute(_CLONE_TOTALS_SQL)).mappings().one()
        return CloneStorage(**row)

    async def detect_drift(
        self, db: AsyncSession, *, include_orphan_size: bool = False
    ) -> StorageDrift:
        """Reconcile clone directories against Repo rows, both directions.

        One filesystem snapshot, then set difference — so a clone created
        mid-scan cannot be reported as both orphaned and missing, which two
        independent passes would allow.

        A Repo whose local_path is not at depth 2 under REPO_ROOT_DIR reads as
        missing even if it exists. Acceptable because clone_path is now the
        only writer of that column.
        """
        on_disk = set(await self._git.list_clone_directories())
        rows = (
            (
                await db.execute(
                    text(
                        """
                        SELECT r.id, r.name, r.local_path, c.name AS collection_name
                        FROM repos r
                        JOIN collections c ON c.id = r.collection_id
                        ORDER BY c.name, r.name
                        """
                    )
                )
            )
            .mappings()
            .all()
        )

        known = {
            os.path.normpath(row["local_path"])
            for row in rows
            if row["local_path"]
        }
        orphan_paths = sorted(on_disk - known)
        missing = [
            DriftItem(
                path=row["local_path"],
                repo_id=row["id"],
                repo_name=row["name"],
                collection_name=row["collection_name"],
            )
            for row in rows
            if not row["local_path"]
            or os.path.normpath(row["local_path"]) not in on_disk
        ]

        orphan_bytes: int | None = None
        if include_orphan_size:
            orphan_bytes = 0
            for path in orphan_paths:
                size = await self._git.get_repo_size(path)
                if size:
                    orphan_bytes += size["total"]

        return StorageDrift(
            orphan_directories=[DriftItem(path=path) for path in orphan_paths],
            missing_clones=missing,
            orphan_bytes=orphan_bytes,
        )

    async def storage_summary(
        self, db: AsyncSession, *, include_orphan_size: bool = False
    ) -> StorageSummary:
        return StorageSummary(
            disk=await self.disk_usage(),
            clones=await self.clone_storage(db),
            database_bytes=await self.database_size(db),
            tables=await self.table_stats(db),
            drift=await self.detect_drift(
                db, include_orphan_size=include_orphan_size
            ),
            # The REAL clone root from config — never AppSettings.
            # repo_root_directory, which is per-user, display-only, and never
            # consulted when building clone paths.
            repo_root_dir=settings.REPO_ROOT_DIR,
            generated_at=datetime.now(timezone.utc),
        )

    async def llm_usage(self, db: AsyncSession, *, days: int = 30) -> LlmUsage:
        """Provider call volume over a window.

        Reports no cost and no failure count, and that is deliberate — see
        the LlmUsage docstring. Spend is priced on the AI Settings tab from
        measured tokens at admin-entered rates; a second figure derived from
        call counts would be an invention, and a failed call writes no row so
        a failure count would always read zero.

        Per-user attribution is not here either. It was a join from summaries
        to collection owner — the closest thing reachable before usage rows
        carried a user_id, and it credited the collection's owner rather than
        whoever spent the tokens. `llm_token_usage.user_id` now answers that
        exactly, and the AI Settings tab reports it as tokens against each
        user's limit, which is the form an administrator can act on.
        """
        params = {"days": days}
        by_model_rows = (await db.execute(_LLM_BY_MODEL_SQL, params)).mappings().all()
        daily_rows = (await db.execute(_LLM_DAILY_SQL, params)).mappings().all()

        by_model = [LlmModelUsage(**row) for row in by_model_rows]
        models_in_use = sorted({row.model for row in by_model})

        # The instance config, not settings.DEFAULT_LLM_MODEL: an administrator
        # picks the model on the AI Settings tab and the env var only seeds that
        # row, so comparing against the env var would flag the configured model
        # itself as retired on any instance whose admin has changed it.
        config = await get_llm_config(db)
        current_default = config.llm_model or settings.DEFAULT_LLM_MODEL

        return LlmUsage(
            window_days=days,
            total_calls=sum(row.calls for row in by_model),
            by_model=by_model,
            daily=[LlmDailyUsage(**row) for row in daily_rows],
            models_in_use=models_in_use,
            # Actionable in a way a cost estimate is not: migration 0002
            # exists because a retired model id began returning 404s.
            retired_models_in_use=[
                model for model in models_in_use if model != current_default
            ],
            current_default_model=current_default,
            generated_at=datetime.now(timezone.utc),
        )

    async def system_status(self, db: AsyncSession) -> SystemStatus:
        """Environment and configuration, for diagnosing a misbehaving instance.

        Extends the /healthz probe rather than reimplementing it: the same
        probe_schema runs here against the request-scoped session, so the two
        endpoints cannot disagree about whether the schema is migrated.
        """
        probe = await probe_schema(db)
        head = head_revision()
        admin_count = int(
            (
                await db.execute(
                    text("SELECT count(*) FROM users WHERE role = 'admin'")
                )
            ).scalar_one()
        )

        root = settings.REPO_ROOT_DIR
        root_exists = os.path.isdir(root)
        # W_OK on the directory, not a write probe: creating a file to test
        # would litter the clone root.
        root_writable = root_exists and os.access(root, os.W_OK)

        up_to_date: bool | None = None
        if probe.revision is not None and head is not None:
            up_to_date = probe.revision == head

        degraded = (
            not probe.reachable
            or not root_exists
            or not root_writable
            or up_to_date is False
        )

        return SystemStatus(
            status="degraded" if degraded else "ok",
            server_time=datetime.now(timezone.utc),
            database="ok" if probe.reachable else "unreachable",
            schema_revision=probe.revision,
            schema_head=head,
            schema_up_to_date=up_to_date,
            auth_mode=settings.AUTH_MODE,
            dev_login_enabled=settings.AUTH_MODE == "dev",
            admin_count=admin_count,
            repo_root_dir=root,
            repo_root_exists=root_exists,
            repo_root_writable=root_writable,
            # Booleans only. Never the value, never a prefix.
            anthropic_api_key_configured=bool(settings.ANTHROPIC_API_KEY),
            github_token_configured=bool(settings.GITHUB_TOKEN),
            default_llm_provider=settings.DEFAULT_LLM_PROVIDER,
            default_llm_model=settings.DEFAULT_LLM_MODEL,
            git_version=await self._git.git_version(),
        )

    async def repo_sizes(
        self,
        db: AsyncSession,
        *,
        limit: int = 50,
        offset: int = 0,
        sort: RepoSizeSort = "size_desc",
        collection_id: uuid.UUID | None = None,
    ) -> tuple[list[RepoStorageItem], int]:
        order_by = _REPO_SORTS[sort]
        # CAST(...) rather than `:collection_id::uuid`: SQLAlchemy's bind
        # regex has a negative lookahead for ':', so the '::' cast suffix
        # stops the parameter binding at all.
        where = (
            "WHERE (CAST(:collection_id AS uuid) IS NULL "
            "OR r.collection_id = CAST(:collection_id AS uuid))"
        )
        params = {
            "collection_id": collection_id,
            "limit": limit,
            "offset": offset,
        }

        rows = (
            (
                await db.execute(
                    text(
                        f"""
                        SELECT r.id, r.name, r.collection_id, c.name AS collection_name,
                               r.local_path, r.size_bytes, r.git_size_bytes,
                               r.size_computed_at
                        FROM repos r
                        JOIN collections c ON c.id = r.collection_id
                        {where}
                        ORDER BY {order_by}
                        LIMIT :limit OFFSET :offset
                        """
                    ),
                    params,
                )
            )
            .mappings()
            .all()
        )
        total = int(
            (
                await db.execute(
                    text(f"SELECT count(*) FROM repos r {where}"),
                    {"collection_id": collection_id},
                )
            ).scalar_one()
        )

        items = [
            RepoStorageItem(
                **row,
                worktree_bytes=(
                    row["size_bytes"] - (row["git_size_bytes"] or 0)
                    if row["size_bytes"] is not None
                    else None
                ),
            )
            for row in rows
        ]
        return items, total

    async def recalculate_repo_sizes(
        self,
        db: AsyncSession,
        *,
        repo_ids: list[uuid.UUID] | None = None,
        collection_id: uuid.UUID | None = None,
        max_repos: int = 100,
    ) -> RecalculateResult:
        """Walk clones and persist their sizes. Synchronous by design.

        Not a background task: one could not use the request-scoped session,
        there is no job table to poll, and a new background function would
        escape the `no_background_indexing` fixture and open a session against
        DATABASE_URL — writing to the developer's real database from the test
        suite.
        """
        started = time.perf_counter()
        query = select(Repo)
        if repo_ids:
            query = query.where(Repo.id.in_(repo_ids))
        if collection_id:
            query = query.where(Repo.collection_id == collection_id)
        targets = list((await db.execute(query)).scalars().all())

        if len(targets) > max_repos:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"{len(targets)} repos exceeds the {max_repos} measured per "
                    "request; scope the request to a collection."
                ),
            )

        semaphore = asyncio.Semaphore(_RECALC_CONCURRENCY)
        now = datetime.now(timezone.utc)

        async def measure(repo: Repo) -> tuple[Repo, dict[str, int] | None, bool]:
            if not repo.local_path:
                return repo, None, False
            async with semaphore:
                try:
                    return repo, await self._git.get_repo_size(repo.local_path), False
                except OSError:
                    return repo, None, True

        results = await asyncio.gather(*(measure(repo) for repo in targets))

        measured = skipped_missing = failed = 0
        total_bytes = 0
        for repo, size, errored in results:
            if errored:
                failed += 1
                continue
            if size is None:
                # Leave the previous measurement alone. A vanished clone is
                # more often an unmounted volume than a deletion, and nulling
                # would destroy the whole fleet's history on one bad mount.
                skipped_missing += 1
                continue
            repo.size_bytes = size["total"]
            repo.git_size_bytes = size["git"]
            repo.size_computed_at = now
            measured += 1
            total_bytes += size["total"]

        await db.commit()

        return RecalculateResult(
            requested=len(targets),
            measured=measured,
            skipped_missing=skipped_missing,
            failed=failed,
            total_bytes=total_bytes,
            duration_ms=int((time.perf_counter() - started) * 1000),
            computed_at=now,
        )

    # ------------------------------------------------------------------
    # Pipeline health
    # ------------------------------------------------------------------

    async def sync_state(self, db: AsyncSession) -> SyncStateCounts:
        row = (await db.execute(_SYNC_STATE_SQL)).mappings().one()
        return SyncStateCounts(**row)

    async def sync_error_groups(self, db: AsyncSession) -> list[SyncErrorGroup]:
        rows = (await db.execute(_SYNC_ERROR_GROUPS_SQL)).mappings().all()
        return [SyncErrorGroup(**row) for row in rows]

    async def sync_age(self, db: AsyncSession) -> list[AgeBucket]:
        row = (await db.execute(_SYNC_AGE_SQL)).mappings().one()
        return [
            AgeBucket(key=key, label=label, repos=row[key])
            for key, label in _AGE_BUCKET_LABELS
        ]

    async def coverage_gaps(
        self, db: AsyncSession, *, drift: StorageDrift
    ) -> list[CoverageGap]:
        """Rows a working pipeline would have filled.

        Takes the drift result rather than recomputing it: `detect_drift` walks
        the filesystem once and does a set difference, so calling it twice
        would both double the I/O and let a clone created between the two
        passes be reported as neither orphaned nor missing.
        """
        repos = (await db.execute(_COVERAGE_SQL)).mappings().one()
        summaries = (await db.execute(_UNATTRIBUTED_SUMMARY_SQL)).mappings().one()

        repo_total = repos["repos"]
        missing = len(drift.missing_clones)
        orphans = len(drift.orphan_directories)

        return [
            CoverageGap(
                key="no_health_score",
                label="Repos with no health score",
                affected=repos["no_health_score"],
                total=repo_total,
            ),
            CoverageGap(
                key="unknown_health",
                label="Repos scored unknown",
                affected=repos["unknown_health"],
                total=repo_total,
            ),
            CoverageGap(
                key="unmeasured_clone",
                label="Clones never measured",
                affected=repos["unmeasured_clone"],
                total=repo_total,
            ),
            CoverageGap(
                key="missing_clone",
                label="Database rows with no files on disk",
                affected=missing,
                total=repo_total,
            ),
            CoverageGap(
                key="orphan_directory",
                label="Directories on disk with no database row",
                # Counted against what is on disk, not against repo rows: a
                # directory with no row is, by definition, not one of the rows,
                # so the repo count is the wrong denominator.
                affected=orphans,
                total=orphans + repo_total - missing,
            ),
            CoverageGap(
                key="unattributed_summary",
                label="Summaries with no repo",
                affected=summaries["unattributed"],
                total=summaries["summaries"],
            ),
        ]

    async def pipeline(self, db: AsyncSession) -> AdminPipeline:
        """Ingestion health and data coverage, as of now.

        Takes no window: every query behind this is point-in-time. It briefly
        accepted one, which scoped an email-delivery figure that no longer
        exists; keeping the parameter would advertise a filter that changes
        nothing in the response.
        """
        # Orphan sizing stays off: walking one abandoned multi-gigabyte clone
        # would stall the landing page this feeds.
        drift = await self.detect_drift(db, include_orphan_size=False)
        return AdminPipeline(
            sync_state=await self.sync_state(db),
            sync_errors=await self.sync_error_groups(db),
            sync_age=await self.sync_age(db),
            coverage=await self.coverage_gaps(db, drift=drift),
            generated_at=datetime.now(timezone.utc),
        )

    # ------------------------------------------------------------------
    # Attention
    # ------------------------------------------------------------------

    async def attention(
        self,
        db: AsyncSession,
        *,
        limit: int = 10,
        offset: int = 0,
        stale_after_days: int = 7,
    ) -> tuple[list[AttentionRepo], int]:
        """Repos carrying an operational fault, worst first.

        Ranked in Python rather than SQL because one of the six reasons —
        `clone_missing` — is only knowable from the filesystem snapshot, and a
        severity computed half in SQL and half here could order rows by a
        number that disagrees with the reasons displayed beside them.

        Bounded by the PRD's repo scale, and the snapshot is one scandir pass
        that `detect_drift` already performs for the same request.

        There is deliberately no `health_red` reason. A red repo that is
        otherwise fine is a struggling student project; putting it in this
        queue would bury the faults only an admin can act on.
        """
        on_disk = set(await self._git.list_clone_directories())
        rows = (await db.execute(_ATTENTION_REPOS_SQL)).mappings().all()
        stale_before = datetime.now(timezone.utc) - timedelta(days=stale_after_days)

        flagged: list[AttentionRepo] = []
        for row in rows:
            codes: list[str] = []

            if row["sync_status"] == "failed":
                codes.append("sync_failed")

            if row["last_synced_at"] is None:
                codes.append("never_synced")
            elif row["last_synced_at"] < stale_before:
                codes.append("stale_sync")

            # A repo that has never synced has no clone yet, which is expected
            # rather than a fault — flagging it would double-count one cause.
            if row["last_synced_at"] is not None and (
                not row["local_path"]
                or os.path.normpath(row["local_path"]) not in on_disk
            ):
                codes.append("clone_missing")

            # NULL is "never measured". 0 is a real measurement of an empty
            # clone and is not a gap.
            if row["size_bytes"] is None:
                codes.append("unmeasured")

            if row["health_score"] is None:
                codes.append("no_health_data")

            if not codes:
                continue

            flagged.append(
                AttentionRepo(
                    id=row["id"],
                    name=row["name"],
                    collection_id=row["collection_id"],
                    collection_name=row["collection_name"],
                    sync_status=row["sync_status"],
                    sync_error=row["sync_error"],
                    last_synced_at=row["last_synced_at"],
                    local_path=row["local_path"],
                    reasons=[
                        AttentionReason(code=code, label=_ATTENTION_LABELS[code])
                        for code in codes
                    ],
                    severity=sum(_ATTENTION_WEIGHTS[code] for code in codes),
                )
            )

        # Name is not a cosmetic tiebreak: without it, LIMIT/OFFSET over rows
        # of equal severity can repeat or skip entries between pages.
        flagged.sort(key=lambda item: (-item.severity, item.name))
        return flagged[offset : offset + limit], len(flagged)
