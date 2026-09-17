from __future__ import annotations

from datetime import datetime

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
    """Redeem a setup link and choose a password.

    The token travels in the body rather than the path so it stays out of
    server access logs and `Referer` headers.
    """

    token: str
    new_password: str = Field(min_length=8)
