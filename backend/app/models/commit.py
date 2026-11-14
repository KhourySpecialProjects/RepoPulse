"""Each repo's commit history as of its last successful sync.

Sync parses the clone and stores the result here (see
`commit_snapshot_service`); every commit reader reads these rows instead of
re-parsing the clone, which costs a `git diff` per commit. Rows are replaced
wholesale on each sync, so they are derived data: a resync rebuilds them from
the clone.
"""
from __future__ import annotations

import uuid

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Integer,
    JSON,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.database import Base


class Commit(Base):
    __tablename__ = "commits"
    __table_args__ = (
        # One row per commit per repo. The same SHA legitimately appears in two
        # repos (a fork, a shared template), so the repo has to be part of it.
        UniqueConstraint("repo_id", "hash", name="uq_commit_repo_hash"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    repo_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("repos.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    hash: Mapped[str] = mapped_column(String(40), nullable=False)
    author_name: Mapped[str] = mapped_column(String(255), nullable=False)
    author_email: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    # Indexed because the snapshot is served newest-first and date-filtered.
    date: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True
    )
    message: Mapped[str] = mapped_column(Text, nullable=False, default="")

    # Every branch containing the commit. A list rather than a join table: it is
    # only ever read back whole, alongside the commit it belongs to.
    branches: Mapped[list | None] = mapped_column(JSON, nullable=True)
    # The single branch the work was done on; what the branch filter matches.
    origin_branch: Mapped[str] = mapped_column(String(255), nullable=False, default="")

    insertions: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    deletions: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    files_changed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # When this snapshot row was written, i.e. the sync it came from.
    created_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
