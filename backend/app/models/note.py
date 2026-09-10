from __future__ import annotations

import uuid
from typing import Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base


class Note(Base):
    __tablename__ = "notes"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    author_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    repo_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("repos.id"), nullable=True
    )
    contributor_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("contributors.id"), nullable=True
    )
    content: Mapped[str] = mapped_column(Text, nullable=False)
    commit_hash: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    is_reminder: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    reminder_context: Mapped[str | None] = mapped_column(Text, nullable=True)
    # When the reminder should fire. NULL means the reminder has no due date and
    # will never produce a notification.
    remind_at: Mapped[DateTime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    is_checked: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)
    created_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    author: Mapped[object] = relationship(
        "User", back_populates="notes", lazy="selectin"
    )
    repo: Mapped[object | None] = relationship(
        "Repo", back_populates="notes", lazy="selectin"
    )
    contributor: Mapped[object | None] = relationship(
        "Contributor", back_populates="notes", lazy="selectin"
    )
    comments: Mapped[list["NoteComment"]] = relationship(
        "NoteComment",
        back_populates="note",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
