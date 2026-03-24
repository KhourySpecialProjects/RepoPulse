from __future__ import annotations

import uuid

from sqlalchemy import DateTime, Enum, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base


class Summary(Base):
    __tablename__ = "summaries"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    repo_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("repos.id"), nullable=True
    )
    contributor_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("contributors.id"), nullable=True
    )
    summary_type: Mapped[str] = mapped_column(
        Enum(
            "repo_overview",
            "contributor_activity",
            "health_explanation",
            name="summarytype",
        ),
        nullable=False,
    )
    content: Mapped[str] = mapped_column(Text, nullable=False)
    model_used: Mapped[str] = mapped_column(String(255), nullable=False)
    generated_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # Relationships
    repo: Mapped[object | None] = relationship(
        "Repo", back_populates="summaries", lazy="selectin"
    )
    contributor: Mapped[object | None] = relationship(
        "Contributor", back_populates="summaries", lazy="selectin"
    )
