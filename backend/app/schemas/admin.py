"""Response schemas for the instance-wide administrator dashboard.

Scalar-summary endpoints return a flat object; list endpoints keep the house
`{items, total, limit, offset}` envelope. Byte counts are always integers —
formatting belongs to the client, so no pre-formatted strings appear here.
"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


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
