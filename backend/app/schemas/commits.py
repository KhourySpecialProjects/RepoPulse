from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class CommitRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    hash: str
    author_name: str
    author_email: str
    date: datetime
    message: str
    branches: list[str]
    insertions: int
    deletions: int
    files_changed: int


class PaginatedCommits(BaseModel):
    items: list[CommitRead]
    total: int
    limit: int
    offset: int
