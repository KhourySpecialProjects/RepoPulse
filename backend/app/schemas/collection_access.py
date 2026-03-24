from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict


class CollectionAccessRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    collection_id: uuid.UUID
    user_id: uuid.UUID
    user_display_name: str
    user_email: str
    user_role: str
    access_role: str
    created_at: datetime


class CollectionAccessCreate(BaseModel):
    user_id: uuid.UUID
    access_role: Literal["co_instructor", "ta"]


class CollectionAccessListResponse(BaseModel):
    items: list[CollectionAccessRead]
    total: int
    limit: int
    offset: int
