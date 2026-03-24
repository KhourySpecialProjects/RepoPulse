from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict


class CollectionCreate(BaseModel):
    name: str
    course_tag: Optional[str] = None
    semester_tag: Optional[str] = None
    local_folder_name: str


class CollectionUpdate(BaseModel):
    name: Optional[str] = None
    course_tag: Optional[str] = None
    semester_tag: Optional[str] = None
    local_folder_name: Optional[str] = None
    is_archived: Optional[bool] = None


class CollectionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    course_tag: Optional[str] = None
    semester_tag: Optional[str] = None
    local_folder_name: str
    owner_id: uuid.UUID
    created_at: datetime
    updated_at: datetime
    repo_count: int = 0
    is_archived: bool = False
    health_green: int = 0
    health_yellow: int = 0
    health_red: int = 0
    health_unknown: int = 0


class PaginatedCollections(BaseModel):
    items: list[CollectionRead]
    total: int
    limit: int
    offset: int
