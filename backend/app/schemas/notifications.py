from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict


class NotificationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    type: str
    note_id: Optional[uuid.UUID] = None
    comment_id: Optional[uuid.UUID] = None
    is_read: bool
    created_at: datetime
    note_content_preview: Optional[str] = None
    repo_id: Optional[uuid.UUID] = None


class NotificationListResponse(BaseModel):
    items: list[NotificationRead]
    total: int
    unread_count: int


class ReminderRead(BaseModel):
    """An outstanding reminder, as shown in the notifications panel."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    content: str
    remind_at: Optional[datetime] = None
    reminder_context: Optional[str] = None
    repo_id: Optional[uuid.UUID] = None
    commit_hash: Optional[str] = None
    created_at: datetime
    # Who set it, and the other people it was shared with
    owner_display_name: str = ""
    shared_with: list[str] = []
    is_owner: bool = True


class ReminderListResponse(BaseModel):
    items: list[ReminderRead]
    total: int


class RecentlyDeletedItem(BaseModel):
    """A soft-deleted notification or reminder, restorable until purged."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    kind: str  # "notification" | "reminder"
    label: str
    detail: Optional[str] = None
    deleted_at: datetime


class RecentlyDeletedListResponse(BaseModel):
    items: list[RecentlyDeletedItem]
    total: int
