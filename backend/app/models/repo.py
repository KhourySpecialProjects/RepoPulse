from __future__ import annotations

import uuid

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, JSON, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base


class Repo(Base):
    __tablename__ = "repos"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    collection_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("collections.id"), nullable=False
    )
    github_url: Mapped[str] = mapped_column(String(500), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    local_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    health_status: Mapped[str] = mapped_column(
        Enum("green", "yellow", "red", "unknown", name="healthstatus"),
        default="unknown",
    )
    health_score: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    last_synced_at: Mapped[DateTime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    expected_contributor_count: Mapped[int | None] = mapped_column(
        Integer, nullable=True
    )
    created_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    collection: Mapped[object] = relationship(
        "Collection", back_populates="repos", lazy="selectin"
    )
    contributors: Mapped[list["Contributor"]] = relationship(
        "Contributor", back_populates="repo", lazy="selectin"
    )
    notes: Mapped[list["Note"]] = relationship(
        "Note", back_populates="repo", lazy="selectin"
    )
    summaries: Mapped[list["Summary"]] = relationship(
        "Summary", back_populates="repo", lazy="selectin"
    )
