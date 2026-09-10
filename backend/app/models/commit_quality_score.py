from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.database import Base


class CommitQualityScore(Base):
    __tablename__ = "commit_quality_scores"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    repo_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("repos.id", ondelete="CASCADE"), nullable=False)
    commit_hash: Mapped[str] = mapped_column(String(40), nullable=False)  # full SHA
    score: Mapped[str] = mapped_column(String(10), nullable=False)        # 'good' | 'ok' | 'bad'
    model_used: Mapped[str] = mapped_column(String(100), nullable=False)
    scored_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    __table_args__ = (
        UniqueConstraint("repo_id", "commit_hash", name="uq_commit_quality_repo_hash"),
    )
