from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class DevLoginRequest(BaseModel):
    user_id: str


class LoginRequest(BaseModel):
    email: str
    password: str


class TokenResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    access_token: str
    token_type: str = "bearer"
    user_id: str
    display_name: str
    role: str


class SetupLinkResponse(BaseModel):
    """An account setup link, returned to the admin who minted it.

    The raw token appears here and nowhere else — only its hash is stored, so
    this response is the one chance to hand it over. `setup_path` is relative
    because the app has no configured public origin; the admin's browser
    prefixes its own.
    """

    token: str
    setup_path: str
    expires_at: datetime


class SetupTokenInfo(BaseModel):
    """What the setup page may know before anyone has authenticated.

    Enough to show the recipient the link is really theirs, and no more: no id
    and no role, since this is readable by anyone holding the token.
    """

    email: str
    display_name: str
    expires_at: datetime


class VerifySetupTokenRequest(BaseModel):
    token: str


class CompleteSetupRequest(BaseModel):
    """Redeem a setup link, choose a password, and optionally hand over a PAT.

    The token travels in the body rather than the path so it stays out of
    server access logs and `Referer` headers.

    `github_token` is the recipient's own GitHub credential, offered here
    because this is the first and only moment they are identified without an
    admin in the room. Absent or empty means *leave it alone*, never *clear
    it*: the same link doubles as password reset, and someone resetting a
    forgotten password has no reason to re-type a working token.
    """

    token: str
    new_password: str = Field(min_length=8)
    github_token: Optional[str] = None
