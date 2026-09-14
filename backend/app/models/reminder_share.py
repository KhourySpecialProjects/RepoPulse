from __future__ import annotations

import uuid

from sqlalchemy import DateTime, ForeignKey, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base


class ReminderShare(Base):
    """A reminder shared with another user.

    The note's author always sees their own reminder; these rows add the extra
    people it is shared with, so a reminder can be handed to several users at
    once and fire for each of them.
    """

    __tablename__ = "reminder_shares"
    __table_args__ = (
        UniqueConstraint("note_id", "user_id", name="uq_reminder_share_note_user"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    note_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("notes.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    created_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    note: Mapped[object] = relationship("Note", lazy="selectin")
    user: Mapped[object] = relationship("User", lazy="selectin")
