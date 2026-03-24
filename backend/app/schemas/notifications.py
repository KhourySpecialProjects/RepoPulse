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
