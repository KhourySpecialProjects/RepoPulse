from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict


class NoteCommentCreate(BaseModel):
    content: str


class NoteCommentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    note_id: uuid.UUID
    author_id: uuid.UUID
    author_display_name: str
    content: str
    created_at: datetime
    updated_at: datetime


class NoteCreate(BaseModel):
    repo_id: Optional[uuid.UUID] = None
    contributor_id: Optional[uuid.UUID] = None
    content: str
    commit_hash: Optional[str] = None
    is_reminder: bool = False
    reminder_context: Optional[str] = None


class NoteUpdate(BaseModel):
    content: Optional[str] = None
    is_reminder: Optional[bool] = None
    reminder_context: Optional[str] = None
    is_checked: Optional[bool] = None
    is_archived: Optional[bool] = None


class NoteRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    author_id: uuid.UUID
    author_display_name: str
    repo_id: Optional[uuid.UUID] = None
    contributor_id: Optional[uuid.UUID] = None
    content: str
    commit_hash: Optional[str] = None
    is_reminder: bool
    reminder_context: Optional[str] = None
    is_checked: bool = False
    is_archived: bool = False
    created_at: datetime
    updated_at: datetime
    comments: list[NoteCommentRead] = []


class PaginatedNotes(BaseModel):
    items: list[NoteRead]
    total: int
    limit: int
    offset: int
