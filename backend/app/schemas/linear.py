from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Literal, Optional

from pydantic import BaseModel


class LinearTeamRead(BaseModel):
    id: str
    key: str
    name: str


class LinearTeamList(BaseModel):
    items: list[LinearTeamRead]
    total: int
    limit: int
    offset: int


class LinearStatusCounts(BaseModel):
    """Issues per Linear workflow-state *type*.

    Types rather than state names: every team names its states differently
    ("In Review", "QA"), but each one belongs to one of these six types.
    """
    triage: int = 0
    backlog: int = 0
    unstarted: int = 0
    started: int = 0
    completed: int = 0
    canceled: int = 0


class LinearCycleProgress(BaseModel):
    number: int
    name: Optional[str] = None
    starts_at: datetime
    ends_at: datetime
    # Linear's own figure (0.0–1.0), so the panel agrees with Linear's UI.
    progress: float
    issue_count: int
    completed_issue_count: int


class LinearWeeklyCompletion(BaseModel):
    week_start: date  # Monday, UTC
    completed: int


class LinearMemberStats(BaseModel):
    name: str
    open: int
    completed: int


class LinearTeamStats(BaseModel):
    status_counts: LinearStatusCounts
    total_issues: int
    active_cycle: Optional[LinearCycleProgress] = None
    completed_per_week: list[LinearWeeklyCompletion]
    members: list[LinearMemberStats]


class RepoLinearResponse(BaseModel):
    """What the Linear panel on Repo Detail renders.

    `status` is one of the three states the panel has to draw, none of which is
    an error: `not_configured` (the viewer has no Linear key), `no_team` (no
    team linked or matched), and `ok`. A rejected key or a Linear outage is an
    error response instead.
    """
    status: Literal["not_configured", "no_team", "ok"]
    team: Optional[LinearTeamRead] = None
    matched_by: Optional[Literal["manual", "auto"]] = None
    stats: Optional[LinearTeamStats] = None
    # Whether the viewer may change which team is linked (owner/co-instructor).
    can_change_team: bool = False


class RepoLinearTeamSummary(BaseModel):
    """One dashboard row: a repo and the Linear team it shows.

    The team is decided exactly as on Repo Detail — the picked team, else a
    name match (linear_service.resolve_team) — so the two can never disagree.
    """
    repo_id: uuid.UUID
    repo_name: str
    collection_id: uuid.UUID
    team: LinearTeamRead
    matched_by: Literal["manual", "auto"]
    stats: LinearTeamStats


class RepoLinearTeamList(BaseModel):
    items: list[RepoLinearTeamSummary]
    total: int
    limit: int
    offset: int
