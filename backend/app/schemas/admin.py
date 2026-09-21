"""Response schemas for the instance-wide administrator dashboard.

Scalar-summary endpoints return a flat object; list endpoints keep the house
`{items, total, limit, offset}` envelope. Byte counts are always integers —
formatting belongs to the client, so no pre-formatted strings appear here.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
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


#: The LLM features that spend tokens, and so the series the volume graph
#: stacks. Mirrors the FEATURE_* constants on app/models/llm_token_usage.py —
#: `commit_quality` was invisible while call volume came from a two-table
#: union, which made the graph's series sum to less than its own total.
LlmUsageKind = Literal["summary", "commit_classification", "commit_quality"]


class LlmModelUsage(BaseModel):
    kind: LlmUsageKind
    model: str
    calls: int
    first_at: datetime | None = None
    last_at: datetime | None = None


class LlmDailyUsage(BaseModel):
    day: date
    kind: LlmUsageKind
    calls: int


class LlmUsage(BaseModel):
    """Provider call volume over a window.

    `total_calls` counts requests to the provider, not rows in a table. It is
    summed from `llm_token_usage.calls`, which the adapters increment once per
    request. The previous source was a union over `summaries` and
    `commit_classifications`: one-per-artefact tables, so classifying 222
    commits reported 222 calls against six batched requests, and the figure
    tracked repo size rather than load.

    Deliberately carries no cost estimate and no failure count.

    Cost belongs to the AI Settings tab, which prices measured tokens at rates
    an administrator entered. A spend figure derived from call volume alone
    would be `calls x assumed-tokens x assumed-price` — invented inputs
    producing a number that reads as measured and is wrong by a multiple.

    Failures are unavailable by construction: a failed call writes no usage
    row, so these rows are only successes and a "0 failures" tile would lie.

    `retired_models_in_use` is the actionable signal instead — models present
    in history that are not the instance's configured model. Migration 0002
    exists because a retired model id started returning 404s.

    Per-user attribution is absent on purpose. It used to be a join from
    summaries to collection owner, which credited the collection's owner
    rather than whoever spent the tokens; `llm_token_usage.user_id` now
    answers it exactly, and the AI Settings tab reports it against each
    user's limit. Nothing on the dashboard read the old field.
    """

    window_days: int
    total_calls: int
    by_model: list[LlmModelUsage]
    daily: list[LlmDailyUsage]
    models_in_use: list[str]
    retired_models_in_use: list[str]
    current_default_model: str
    generated_at: datetime


class SystemStatus(BaseModel):
    """Configuration and environment, for diagnosing a misbehaving instance.

    Secrets are reported as booleans only — never the value, never a prefix,
    never a length. A four-character prefix of an API key is still a key
    fragment once it reaches a log aggregator.

    Returns 200 even when degraded: authenticating the admin already required
    a successful database read, so a truly unreachable database cannot reach
    this handler, and a 503 would make the UI render a generic error page
    instead of the diagnostic it exists to show.
    """

    status: Literal["ok", "degraded"]
    server_time: datetime

    database: Literal["ok", "unreachable"]
    schema_revision: str | None = None
    schema_head: str | None = None
    # None when the revision cannot be read — the test database is built by
    # create_all and has no alembic_version, so this is null under test.
    schema_up_to_date: bool | None = None

    auth_mode: str
    # AUTH_MODE=dev serves POST /auth/dev-login, which mints a full token
    # from a bare user id with no password. Surfaced, never blocked —
    # refusing it would break local development.
    dev_login_enabled: bool
    admin_count: int

    repo_root_dir: str
    repo_root_exists: bool
    repo_root_writable: bool

    anthropic_api_key_configured: bool
    github_token_configured: bool
    default_llm_provider: str
    default_llm_model: str
    git_version: str | None = None


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


# ---------------------------------------------------------------------------
# Pipeline health
#
# This block answers "is the application working", not "how are the students
# doing". The distinction matters: an instructor wants the green/yellow/red
# spread, while an admin wants to know whether the scoring pipeline ran at
# all. So health data appears here only as coverage — `unknown` status and a
# NULL health_score — and never as a performance breakdown.
# ---------------------------------------------------------------------------


class SyncStateCounts(BaseModel):
    """Current Repo.sync_status across the instance, zero-filled.

    All three states always present: a `failed` key that disappears when
    nothing is failing would make a healthy instance and a broken query look
    identical to the client.
    """

    idle: int = 0
    syncing: int = 0
    failed: int = 0


class SyncErrorGroup(BaseModel):
    """Repos grouped by identical `sync_error`.

    Grouped rather than listed because the shape of the failure is the
    diagnosis. One bad credential or one unreachable host reads as a single
    row with a count of twelve, instead of twelve rows an admin has to
    compare by eye to notice they are the same fault.

    `example_repo_name` gives somewhere to start looking without widening the
    response into a full per-repo list — /admin/attention is that list.
    """

    error: str
    repos: int
    example_repo_name: str
    last_seen: datetime | None = None


class AgeBucket(BaseModel):
    """One bucket of an ordered age histogram.

    `never` is deliberately a bucket rather than a zero: a repo that has never
    synced is not "synced a very long time ago", and averaging it in either
    direction would misstate the fleet.
    """

    key: Literal["lt1d", "1to3d", "3to7d", "7to30d", "gt30d", "never"]
    label: str
    repos: int


class CoverageGap(BaseModel):
    """Rows missing data that a working pipeline would have filled.

    Always carries its own `total`. The denominators genuinely differ per gap
    — orphan directories are counted against directories on disk, not against
    repo rows — and a bar drawn against the wrong one would overstate the
    problem.
    """

    key: Literal[
        "no_health_score",
        "unknown_health",
        "unmeasured_clone",
        "missing_clone",
        "orphan_directory",
        "unattributed_summary",
    ]
    label: str
    affected: int
    total: int


class AdminPipeline(BaseModel):
    """A snapshot. Deliberately carries no window.

    Every figure here is point-in-time: the live sync state, the failures
    grouped by cause, how long ago each repo last pulled, and what the
    pipeline has not filled in. None of it is scoped to a date range, so
    accepting one would promise a filter the response does not honour.
    """

    sync_state: SyncStateCounts
    sync_errors: list[SyncErrorGroup]
    # Over last_synced_at (when we last pulled), never last_commit_at (when a
    # student last pushed). Only the former is an operations metric.
    sync_age: list[AgeBucket]
    coverage: list[CoverageGap]
    generated_at: datetime


# ---------------------------------------------------------------------------
# Attention
# ---------------------------------------------------------------------------

AttentionCode = Literal[
    "sync_failed",
    "never_synced",
    "stale_sync",
    "clone_missing",
    "unmeasured",
    "no_health_data",
]


class AttentionReason(BaseModel):
    code: AttentionCode
    label: str


class AttentionRepo(BaseModel):
    """A repo with at least one operational fault.

    Reasons are operational only. There is deliberately no `health_red`: a
    failing student project is an instructor's problem, and putting it in an
    admin's action queue would bury the faults only an admin can fix.
    """

    id: uuid.UUID
    name: str
    collection_id: uuid.UUID
    collection_name: str
    sync_status: str
    sync_error: str | None = None
    last_synced_at: datetime | None = None
    local_path: str | None = None
    reasons: list[AttentionReason]
    severity: int


class AdminAttention(BaseModel):
    items: list[AttentionRepo]
    total: int
    limit: int
    offset: int
    generated_at: datetime
