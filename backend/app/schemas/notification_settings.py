"""Request/response shapes for the email relay settings panel."""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.notification_setting import DEFAULT_SUBSCRIBED_EVENTS


class NotificationSettingsRead(BaseModel):
    """What the settings panel renders.

    Deliberately has no `smtp_password` or `resend_api_key`: stored credentials
    are never handed back out, not even to the user who saved them, because a
    GET response is the easiest place to leak one. The `*_set` booleans carry
    the only thing the form actually needs — whether a secret is on file.
    """

    email_enabled: bool
    transport: str
    from_email: Optional[str]
    from_name: Optional[str]

    smtp_host: Optional[str]
    smtp_port: Optional[int]
    smtp_username: Optional[str]
    smtp_encryption: str
    smtp_password_set: bool

    resend_api_key_set: bool

    #: Every known event, defaults merged in, so the UI never has to guess.
    subscribed_events: dict[str, bool]

    #: Whether a send would currently be attempted. Lets the panel warn about a
    #: relay that is switched on but missing a host or a key.
    deliverable: bool


class NotificationSettingsUpdate(BaseModel):
    """A partial update. Unset fields are left alone.

    Secrets follow a three-way convention: absent keeps the stored value, a
    non-empty string replaces it, and an empty string clears it. Without that,
    a form that never receives the password would wipe it on every save.
    """

    model_config = ConfigDict(extra="forbid")

    email_enabled: Optional[bool] = None
    transport: Optional[Literal["smtp", "resend"]] = None
    from_email: Optional[str] = Field(default=None, max_length=255)
    from_name: Optional[str] = Field(default=None, max_length=255)

    smtp_host: Optional[str] = Field(default=None, max_length=255)
    smtp_port: Optional[int] = Field(default=None, ge=1, le=65535)
    smtp_username: Optional[str] = Field(default=None, max_length=255)
    smtp_password: Optional[str] = Field(default=None, max_length=500)
    smtp_encryption: Optional[Literal["none", "starttls", "tls"]] = None

    resend_api_key: Optional[str] = Field(default=None, max_length=500)

    subscribed_events: Optional[dict[str, bool]] = None

    @field_validator("from_email")
    @classmethod
    def _looks_like_an_address(cls, value: Optional[str]) -> Optional[str]:
        """Reject an obviously unusable sender.

        Not full RFC validation — `email-validator` is not a dependency and the
        relay itself is the real authority on what it will accept. This only
        catches the mistake of typing a name into the address field.
        """
        if value is None or value == "":
            return value
        candidate = value.strip()
        if "@" not in candidate or candidate.startswith("@") or candidate.endswith("@"):
            raise ValueError("from_email must be an email address")
        return candidate

    @field_validator("subscribed_events")
    @classmethod
    def _known_events_only(
        cls, value: Optional[dict[str, bool]]
    ) -> Optional[dict[str, bool]]:
        """A misspelled event name would silently never send, so reject it."""
        if value is None:
            return value
        unknown = sorted(set(value) - set(DEFAULT_SUBSCRIBED_EVENTS))
        if unknown:
            raise ValueError(f"unknown notification events: {', '.join(unknown)}")
        return value


class TestEmailRequest(BaseModel):
    """Optional override for who the probe goes to.

    Defaults to the signed-in user's account address. An override is needed
    because development accounts are seeded with `@example.com` addresses,
    which Resend and most real providers refuse to deliver to — without it the
    test button can never succeed locally.

    This is not an open relay: the send goes through the caller's *own* stored
    credentials, which they could use directly anyway, and their provider
    applies its own rate limits and domain verification on top.
    """

    model_config = ConfigDict(extra="forbid")

    to: Optional[str] = Field(default=None, max_length=255)

    @field_validator("to")
    @classmethod
    def _looks_like_an_address(cls, value: Optional[str]) -> Optional[str]:
        # "" means "no override", same as omitting the field.
        if value is None or value.strip() == "":
            return None
        candidate = value.strip()
        if "@" not in candidate or candidate.startswith("@") or candidate.endswith("@"):
            raise ValueError("to must be an email address")
        return candidate


class TestEmailResponse(BaseModel):
    detail: str
    sent_to: str
