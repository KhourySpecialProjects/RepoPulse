from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.database import Base

COMMIT_TYPES = ("substantive", "logistical")
QUALITY_SCORES = ("good", "ok", "bad")


class CommitClassification(Base):
    """LLM-derived per-commit attributes, cached by (repo_id, commit_hash).

    Commits themselves are not persisted — they are parsed from the local git
    clone on demand (see GitService.parse_commits). This is a sidecar table
    keyed by commit hash, so a classification survives re-parsing and only
    costs an LLM call once per commit.

    Both columns are nullable: rows written before commit typing existed have
    a score but no type, and a commit may be typed without being scored.
    """

    __tablename__ = "commit_classifications"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    # index=True yields ix_commit_classifications_repo_id, matching what
    # migration 0014 renames/creates. The old model omitted this index while
    # migration 0011 created it — that drift is why 0014's rename first failed
    # on databases built by create_all.
    repo_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("repos.id", ondelete="CASCADE"), nullable=False, index=True
    )
    commit_hash: Mapped[str] = mapped_column(String(40), nullable=False)  # full SHA
    score: Mapped[str | None] = mapped_column(String(10), nullable=True)          # 'good' | 'ok' | 'bad'
    commit_type: Mapped[str | None] = mapped_column(String(20), nullable=True)    # 'substantive' | 'logistical'
    model_used: Mapped[str] = mapped_column(String(100), nullable=False)
    scored_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    __table_args__ = (
        UniqueConstraint("repo_id", "commit_hash", name="uq_commit_classification_repo_hash"),
        # Declared here as well as in the migration: the test suite builds its
        # schema with Base.metadata.create_all, not Alembic.
        CheckConstraint(
            "commit_type IS NULL OR commit_type IN ('substantive', 'logistical')",
            name="ck_commit_classification_type",
        ),
        CheckConstraint(
            "score IS NULL OR score IN ('good', 'ok', 'bad')",
            name="ck_commit_classification_score",
        ),
    )
