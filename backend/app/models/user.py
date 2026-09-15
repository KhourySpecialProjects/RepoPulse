from __future__ import annotations

import uuid
from typing import Optional

from sqlalchemy import DateTime, Enum, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    email: Mapped[str] = mapped_column(
        String(255), unique=True, nullable=False, index=True
    )
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    display_name: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(
        Enum("instructor", "ta", "admin", name="userrole"),
        nullable=False,
        default="instructor",
    )
    github_token: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # This user's monthly LLM token allowance, overriding
    # LlmConfig.default_monthly_token_limit. Three distinct states, all
    # meaningful, which is why it is nullable rather than defaulted:
    #   NULL -> follow the instance default (what every user starts as)
    #   0    -> no LLM access at all
    #   n    -> exactly n tokens per calendar month
    # Ignored for admins, who are never metered. See services/llm/quota.py.
    monthly_token_limit: Mapped[Optional[int]] = mapped_column(
        Integer, nullable=True, default=None
    )
    created_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    collections: Mapped[list["Collection"]] = relationship(
        "Collection", back_populates="owner", lazy="selectin"
    )
    notes: Mapped[list["Note"]] = relationship(
        "Note", back_populates="author", lazy="selectin"
    )
    app_settings: Mapped[list["AppSettings"]] = relationship(
        "AppSettings", back_populates="user", lazy="selectin"
    )
    collection_accesses: Mapped[list["CollectionAccess"]] = relationship(
        "CollectionAccess", back_populates="user", lazy="selectin"
    )
    note_comments: Mapped[list["NoteComment"]] = relationship(
        "NoteComment", back_populates="author", lazy="selectin"
    )
    notifications: Mapped[list["Notification"]] = relationship(
        "Notification", back_populates="recipient", lazy="selectin"
    )
