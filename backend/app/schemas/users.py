from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict


class UserRead(BaseModel):
    """Safe to return to any authenticated user."""
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str
    display_name: str
    role: str
    created_at: datetime
    updated_at: datetime


class UserDetail(UserRead):
    """Returned to admin or self only."""
    github_token_configured: bool


class UserCreate(BaseModel):
    """Admin-only: create a new user."""
    email: str
    display_name: str
    role: Literal["instructor", "ta", "admin"]
    password: str
    github_token: Optional[str] = None


class UserUpdate(BaseModel):
    """Admin: update any field. Self: display_name/github_token/password only."""
    display_name: Optional[str] = None
    github_token: Optional[str] = None
    role: Optional[Literal["instructor", "ta", "admin"]] = None


class PasswordReset(BaseModel):
    """Admin resets another user's password."""
    new_password: str


class ChangePassword(BaseModel):
    """User changes their own password."""
    current_password: str
    new_password: str


class PatchMeRequest(BaseModel):
    """PATCH /users/me body."""
    display_name: Optional[str] = None
    github_token: Optional[str] = None
    change_password: Optional[ChangePassword] = None


class UserListResponse(BaseModel):
    """Paginated user list."""
    items: list[UserRead]
    total: int
    limit: int
    offset: int
