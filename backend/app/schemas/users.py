from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict

from app.schemas.auth import SetupLinkResponse


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
    """Admin-only: create a new user.

    No password field, and no `github_token` either. Both are the recipient's
    own secrets: the account is created with neither, and the response carries
    a setup link on which they supply both themselves.
    """
    email: str
    display_name: str
    role: Literal["instructor", "ta", "admin"]


class UserCreateResponse(BaseModel):
    """The new user plus the one-time link that activates the account.

    An envelope rather than extra fields on `UserDetail`: the link is not a
    property of the user, it is a credential that exists only in this response
    and is never readable again.
    """
    user: UserDetail
    setup: SetupLinkResponse


class UserUpdate(BaseModel):
    """Admin-only: update a user's display name or role.

    Not their GitHub token. An admin can see whether one is set
    (`UserDetail.github_token_configured`) but cannot write it — see
    `PatchMeRequest`, which is how its owner does.
    """
    display_name: Optional[str] = None
    role: Optional[Literal["instructor", "ta", "admin"]] = None


# No admin-set-password schema. Resetting someone else's password means
# issuing a setup link (`POST /users/{id}/setup-link`) so only they ever know
# it; see app/services/account_setup_service.py.


class ChangePassword(BaseModel):
    """User changes their own password."""
    current_password: str
    new_password: str


class PatchMeRequest(BaseModel):
    """PATCH /users/me body.

    The only route that writes `github_token`, other than redeeming an account
    setup link. Both are the user acting on their own account.
    """
    display_name: Optional[str] = None
    github_token: Optional[str] = None
    change_password: Optional[ChangePassword] = None


class UserListResponse(BaseModel):
    """Paginated user list."""
    items: list[UserRead]
    total: int
    limit: int
    offset: int
