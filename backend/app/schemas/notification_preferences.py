"""Request/response shapes for per-user notification subscriptions."""
from __future__ import annotations

from pydantic import BaseModel, ConfigDict, field_validator

from app.models.notification_preference import DEFAULT_SUBSCRIBED_EVENTS


class NotificationPreferencesRead(BaseModel):
    """Every known event with its current state, defaults merged in.

    Always complete, so the UI renders the full list without having to know
    which events the user happens to have saved.
    """

    subscribed_events: dict[str, bool]


class NotificationPreferencesUpdate(BaseModel):
    """A partial update: send only the events being changed.

    Merging rather than replacing means a client that toggles one checkbox
    cannot accidentally reset the other seven.
    """

    model_config = ConfigDict(extra="forbid")

    subscribed_events: dict[str, bool]

    @field_validator("subscribed_events")
    @classmethod
    def _known_events_only(cls, value: dict[str, bool]) -> dict[str, bool]:
        """A misspelled event would save a key nothing ever reads, so reject it."""
        unknown = sorted(set(value) - set(DEFAULT_SUBSCRIBED_EVENTS))
        if unknown:
            raise ValueError(f"unknown notification events: {', '.join(unknown)}")
        return value
