from __future__ import annotations

import enum
import uuid

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base


class NotificationType(str, enum.Enum):
    """Every kind of notification the app can raise.

    The first three are note-scoped and derive their display text from the
    linked note. The rest are repo-scoped course-activity events, which have no
    note to read from and so carry their own ``subject``/``body``.
    """

    mention = "mention"
    note_comment = "note_comment"
    reminder = "reminder"
    repo_added = "repo_added"
    repo_removed = "repo_removed"
    repo_health_declined = "repo_health_declined"
    pr_opened = "pr_opened"
    pr_merged = "pr_merged"


#: Repo-scoped event types, which store their own text rather than deriving it
#: from a note. Kept here so routes and the email dispatcher agree on the split.
REPO_EVENT_TYPES = frozenset(
    {
        NotificationType.repo_added,
        NotificationType.repo_removed,
        NotificationType.repo_health_declined,
        NotificationType.pr_opened,
        NotificationType.pr_merged,
    }
)


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    recipient_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    type: Mapped[NotificationType] = mapped_column(
        Enum(NotificationType, name="notification_type", create_type=False),
        nullable=False,
    )
    note_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("notes.id", ondelete="CASCADE"),
        nullable=True,
    )
    comment_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("note_comments.id", ondelete="CASCADE"),
        nullable=True,
    )
    # Set on repo-scoped events so the row can link through to the repo. Left
    # NULL on repo_removed: the cascade would delete the very notification that
    # announces the deletion, so that event keeps the repo name in `subject`.
    repo_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("repos.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    # Repo-scoped events have no note to read their text from, so they carry it.
    # NULL for mention/note_comment/reminder, which derive text from the note.
    subject: Mapped[str | None] = mapped_column(String(300), nullable=True)
    body: Mapped[str | None] = mapped_column(Text, nullable=True)
    # When the email relay delivered this notification. NULL means never sent —
    # either the recipient is unsubscribed, the relay is off, or delivery failed.
    emailed_at: Mapped[DateTime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    is_read: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false", nullable=False, index=True
    )
    # Soft delete: dismissed notifications move to Recently deleted rather than
    # disappearing, so an accidental dismissal can be undone. NULL means live.
    # Every listing filters deleted rows out, so the column is indexed.
    deleted_at: Mapped[DateTime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )
    created_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # Relationships
    recipient: Mapped[object] = relationship(
        "User", back_populates="notifications", lazy="selectin"
    )
    note: Mapped[object | None] = relationship("Note", lazy="selectin")
    comment: Mapped[object | None] = relationship("NoteComment", lazy="selectin")
