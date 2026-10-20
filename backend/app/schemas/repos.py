from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict


class RepoCreate(BaseModel):
    github_url: str
    name: Optional[str] = None


class RepoRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    collection_id: uuid.UUID
    github_url: str
    name: str
    local_path: Optional[str] = None
    health_status: str
    health_score: Optional[dict] = None
    last_synced_at: Optional[datetime] = None
    last_commit_at: Optional[datetime] = None
    expected_contributor_count: Optional[int] = None
    created_at: datetime
    updated_at: datetime
    contributor_count: int = 0
    active_reminder_count: int = 0

    # Shared sync state — every viewer of the collection sees the same values.
    sync_status: str = "idle"
    sync_started_at: Optional[datetime] = None
    sync_started_by_name: Optional[str] = None
    sync_error: Optional[str] = None


class RepoUpdate(BaseModel):
    expected_contributor_count: Optional[int] = None


class PaginatedRepos(BaseModel):
    items: list[RepoRead]
    total: int
    limit: int
    offset: int


class AddReposRequest(BaseModel):
    urls: list[str]


class RepoDeleteResponse(BaseModel):
    detail: str
