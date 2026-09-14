from __future__ import annotations

import re
import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, field_validator

# local_folder_name is concatenated into the clone path under REPO_ROOT_DIR, so
# it has to stay a single plain folder name — no separators, and nothing that
# resolves upwards out of the mount.
_SAFE_FOLDER_NAME = re.compile(r"^[A-Za-z0-9._-]+$")


def _validate_folder_name(value: str) -> str:
    if not _SAFE_FOLDER_NAME.match(value) or value.startswith("."):
        raise ValueError(
            "local_folder_name must contain only letters, digits, dots, dashes "
            "or underscores, and cannot start with a dot"
        )
    return value


class CollectionCreate(BaseModel):
    name: str
    course_tag: Optional[str] = None
    semester_tag: Optional[str] = None
    local_folder_name: str

    @field_validator("local_folder_name")
    @classmethod
    def _check_folder_name(cls, value: str) -> str:
        return _validate_folder_name(value)


class CollectionUpdate(BaseModel):
    name: Optional[str] = None
    course_tag: Optional[str] = None
    semester_tag: Optional[str] = None
    local_folder_name: Optional[str] = None
    is_archived: Optional[bool] = None

    @field_validator("local_folder_name")
    @classmethod
    def _check_folder_name(cls, value: Optional[str]) -> Optional[str]:
        return value if value is None else _validate_folder_name(value)


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


class CommitActivityPoint(BaseModel):
    date: str  # YYYY-MM-DD
    count: int


class CollectionCommitActivity(BaseModel):
    activity: list[CommitActivityPoint]
