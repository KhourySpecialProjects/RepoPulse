"""Per-user notification subscriptions.

One row per user, holding only the map of which events they still want. A
professor and a TA on the same collection therefore make independent choices:
the TA muting pull requests changes nothing about what the professor receives.

Unsubscribing suppresses creation rather than hiding an existing row — see
`notification_service.notify`.
"""
from __future__ import annotations

import uuid

from sqlalchemy import DateTime, ForeignKey, JSON, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base
from app.models.notification import NotificationType

#: What a user who has never edited their subscriptions receives. Everything is
#: on: muting is the explicit act, so a notification type added later reaches
#: people rather than being silently withheld from them.
DEFAULT_SUBSCRIBED_EVENTS: dict[str, bool] = {
    member.value: True for member in NotificationType
}


class NotificationPreference(Base):
    __tablename__ = "notification_preferences"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )

    # NotificationType value -> bool. JSON rather than a column per event, so
    # adding a notification type needs no migration. NULL means "never edited",
    # which reads as DEFAULT_SUBSCRIBED_EVENTS.
    subscribed_events: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    created_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    user: Mapped[object] = relationship("User", lazy="selectin")

    def is_subscribed(self, event: str) -> bool:
        """True when this user still wants ``event``.

        An event missing from a stored map counts as subscribed, so a type
        added after the user last saved keeps reaching them instead of being
        mistaken for something they turned off.
        """
        events = self.subscribed_events or DEFAULT_SUBSCRIBED_EVENTS
        return bool(events.get(event, DEFAULT_SUBSCRIBED_EVENTS.get(event, False)))
