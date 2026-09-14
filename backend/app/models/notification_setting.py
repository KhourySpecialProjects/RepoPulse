"""Per-user email relay configuration and event subscriptions.

Kept in its own table rather than bolted onto ``AppSettings`` because it holds
a credential set with a different lifecycle: an instructor may reconfigure
their relay repeatedly without touching LLM or repo-root settings, and the
per-event subscription map grows every time a new notification type is added.
"""
from __future__ import annotations

import uuid

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, JSON, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base
from app.models.notification import NotificationType

#: Which notification types email is sent for when a user has never edited
#: their subscriptions. Everything is on: a user who switched the relay on
#: asked to be emailed, and muting individual events is the explicit opt-out.
DEFAULT_SUBSCRIBED_EVENTS: dict[str, bool] = {
    member.value: True for member in NotificationType
}

#: Transports the relay can send through. Mirrors the LLM provider split.
EMAIL_TRANSPORTS = ("smtp", "resend")

#: SMTP connection security modes, named as Coolify presents them.
SMTP_ENCRYPTIONS = ("none", "starttls", "tls")


class NotificationSetting(Base):
    __tablename__ = "notification_settings"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )

    # Master switch. While false nothing is ever emailed, whatever the
    # subscriptions say, so turning the relay off is a single reversible action.
    email_enabled: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false", nullable=False
    )
    transport: Mapped[str] = mapped_column(
        String(20), default="smtp", server_default="smtp", nullable=False
    )

    # Envelope sender, shared by both transports.
    from_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    from_name: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # SMTP transport
    smtp_host: Mapped[str | None] = mapped_column(String(255), nullable=True)
    smtp_port: Mapped[int | None] = mapped_column(Integer, nullable=True)
    smtp_username: Mapped[str | None] = mapped_column(String(255), nullable=True)
    smtp_password: Mapped[str | None] = mapped_column(String(500), nullable=True)
    smtp_encryption: Mapped[str] = mapped_column(
        String(20), default="starttls", server_default="starttls", nullable=False
    )

    # Resend transport
    resend_api_key: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # NotificationType value -> bool. JSON rather than a column per event so
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
        """True when this user wants an email for ``event``.

        The master switch wins, then the stored map, then the default. An event
        missing from a stored map is treated as subscribed, so notification
        types added after a user last saved their settings still reach them.
        """
        if not self.email_enabled:
            return False
        events = self.subscribed_events or DEFAULT_SUBSCRIBED_EVENTS
        return bool(events.get(event, DEFAULT_SUBSCRIBED_EVENTS.get(event, False)))

    def has_transport_config(self) -> bool:
        """True when the transport fields are filled in, switch aside.

        Separate from `is_deliverable` so the "send test email" button works
        before the relay is switched on — verifying the credentials is the
        natural thing to do *before* enabling delivery.
        """
        if not self.from_email:
            return False
        if self.transport == "resend":
            return bool(self.resend_api_key)
        return bool(self.smtp_host and self.smtp_port)

    def is_deliverable(self) -> bool:
        """True when the relay is switched on and fully configured."""
        return bool(self.email_enabled) and self.has_transport_config()
