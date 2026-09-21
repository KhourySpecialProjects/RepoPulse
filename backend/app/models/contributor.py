from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, Integer, JSON, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base


class Contributor(Base):
    __tablename__ = "contributors"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    display_name: Mapped[str] = mapped_column(String(255), nullable=False)
    repo_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("repos.id"), nullable=False
    )
    created_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    commit_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    total_insertions: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    total_deletions: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    last_commit_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    merge_history: Mapped[list[dict] | None] = mapped_column(JSON, nullable=True)

    @property
    def can_unmerge(self) -> bool:
        return bool(self.merge_history)

    # Relationships
    repo: Mapped[object] = relationship(
        "Repo", back_populates="contributors", lazy="selectin"
    )
    aliases: Mapped[list["ContributorAlias"]] = relationship(
        "ContributorAlias", back_populates="contributor", lazy="selectin"
    )
    notes: Mapped[list["Note"]] = relationship(
        "Note", back_populates="contributor", lazy="selectin"
    )
    summaries: Mapped[list["Summary"]] = relationship(
        "Summary", back_populates="contributor", lazy="selectin"
    )
