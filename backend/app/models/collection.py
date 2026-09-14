from __future__ import annotations

import uuid

from sqlalchemy import Boolean, DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base


class Collection(Base):
    __tablename__ = "collections"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    course_tag: Mapped[str | None] = mapped_column(String(100), nullable=True)
    semester_tag: Mapped[str | None] = mapped_column(String(100), nullable=True)
    local_folder_name: Mapped[str] = mapped_column(String(255), nullable=False)
    owner_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    created_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)

    # Relationships
    owner: Mapped[object] = relationship(
        "User", back_populates="collections", lazy="selectin"
    )
    repos: Mapped[list["Repo"]] = relationship(
        "Repo", back_populates="collection", lazy="selectin"
    )
    access_entries: Mapped[list["CollectionAccess"]] = relationship(
        "CollectionAccess",
        back_populates="collection",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
