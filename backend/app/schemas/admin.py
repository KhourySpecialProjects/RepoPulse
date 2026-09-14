"""Response schemas for the instance-wide administrator dashboard.

Scalar-summary endpoints return a flat object; list endpoints keep the house
`{items, total, limit, offset}` envelope. Byte counts are always integers —
formatting belongs to the client, so no pre-formatted strings appear here.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel

RepoSizeSort = Literal["size_desc", "size_asc", "name_asc", "measured_asc"]


class EntityCounts(BaseModel):
    """Exact row counts, instance-wide.

    Exact rather than estimated on purpose: `admins` drives a lockout warning
    (exactly one admin is a risk, zero is unrecoverable), which must not be an
    approximation. At this scale the scans are microseconds.

    There is deliberately no `orphaned_collections`: `Collection.owner_id` is
    NOT NULL behind an enforced foreign key, so a collection whose owner was
    deleted cannot exist. A counter that can only ever read zero would imply a
    check that means something.
    """

    users: int
    admins: int
    instructors: int
    tas: int
    collections: int
    archived_collections: int
    repos: int
    contributors: int
    notes: int
    note_comments: int
    summaries: int
    commit_classifications: int
    pull_requests: int
    notifications: int
    collection_access: int


class HealthDistribution(BaseModel):
    """Repo health across the whole instance.

    All four statuses are always present and zero-filled. PRD §5.3 marks stale
    repos `unknown`, so a rising `unknown` count is an ops failure rather than
    a student failure — this is the panel that tells those apart.
    """

    green: int = 0
    yellow: int = 0
    red: int = 0
    unknown: int = 0


class SyncFreshness(BaseModel):
    total: int
    never_synced: int
    stale: int
    fresh: int
    stale_after_days: int
    most_recent_sync: datetime | None = None
    oldest_sync: datetime | None = None


class AdminOverview(BaseModel):
    counts: EntityCounts
    health: HealthDistribution
    sync: SyncFreshness
    generated_at: datetime


# ---------------------------------------------------------------------------
# Storage
# ---------------------------------------------------------------------------


class TableStat(BaseModel):
    """Per-table size and row count.

    Two row numbers on purpose. `row_count` is an exact count(*) and is what
    should be displayed. `row_estimate` is pg_stat_user_tables.n_live_tup,
    which autovacuum maintains and which reads 0 immediately after inserts —
    useful for spotting bloat against the exact count, useless as a display
    value on a freshly seeded instance.
    """

    table_name: str
    total_bytes: int
    table_bytes: int
    index_bytes: int
    row_count: int
    row_estimate: int


class DiskUsage(BaseModel):
    """Free space on the volume holding the clones.

    `exists` is false when REPO_ROOT_DIR is not mounted — a deployment state
    worth showing plainly rather than reporting as zero bytes used.
    """

    root: str
    exists: bool
    total_bytes: int
    used_bytes: int
    free_bytes: int
    percent_used: float


class CloneStorage(BaseModel):
    """Totals from the persisted per-repo measurements.

    `unmeasured_repos` counts NULL size_bytes — never measured, as distinct
    from measured-and-empty. `oldest_measurement` is what makes a stale total
    look stale.
    """

    measured_repos: int
    unmeasured_repos: int
    total_bytes: int
    git_bytes: int
    oldest_measurement: datetime | None = None
    newest_measurement: datetime | None = None


class DriftItem(BaseModel):
    path: str | None = None
    repo_id: uuid.UUID | None = None
    repo_name: str | None = None
    collection_name: str | None = None


class StorageDrift(BaseModel):
    """Disagreement between the database and the disk, both directions.

    Reporting only — there is no reclaim action. repo_removal_service deletes
    rows "without touching local or remote git files", so orphan_directories
    is the accumulated cost of every repo ever removed.

    orphan_bytes is None unless explicitly requested: sizing the orphans means
    walking them, and one abandoned 2 GB clone would stall the default load.
    """

    orphan_directories: list[DriftItem]
    missing_clones: list[DriftItem]
    orphan_bytes: int | None = None


class StorageSummary(BaseModel):
    disk: DiskUsage
    clones: CloneStorage
    database_bytes: int
    tables: list[TableStat]
    drift: StorageDrift
    repo_root_dir: str
    generated_at: datetime


class RepoStorageItem(BaseModel):
    id: uuid.UUID
    name: str
    collection_id: uuid.UUID
    collection_name: str
    local_path: str | None = None
    size_bytes: int | None = None
    git_size_bytes: int | None = None
    # Derived, never stored: a fourth column could disagree with the other two.
    worktree_bytes: int | None = None
    size_computed_at: datetime | None = None


class RepoStorageListResponse(BaseModel):
    items: list[RepoStorageItem]
    total: int
    limit: int
    offset: int


class RecalculateRequest(BaseModel):
    repo_ids: list[uuid.UUID] | None = None
    collection_id: uuid.UUID | None = None


class RecalculateResult(BaseModel):
    """Outcome of a re-measurement pass.

    `skipped_missing` counts clones that were not on disk. Those keep their
    previous measurement: a vanished clone is far more often an unmounted
    volume than a deletion, and nulling would wipe the fleet's history on one
    bad mount.
    """

    requested: int
    measured: int
    skipped_missing: int
    failed: int
    total_bytes: int
    duration_ms: int
    computed_at: datetime
