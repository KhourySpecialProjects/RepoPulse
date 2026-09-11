from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict


class AliasRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    git_email: str
    git_name: str


class ContributorRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    display_name: str
    repo_id: uuid.UUID
    created_at: datetime
    aliases: list[AliasRead] = []
    can_unmerge: bool = False
    commit_count: int = 0
    total_insertions: int = 0
    total_deletions: int = 0
    last_commit_at: Optional[datetime] = None


class ContributorUpdate(BaseModel):
    display_name: str


class MergeContributorsRequest(BaseModel):
    contributor_ids: list[uuid.UUID]
    display_name: str


class UnmergeContributorsResponse(BaseModel):
    contributors: list[ContributorRead]
