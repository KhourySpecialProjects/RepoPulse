"""snapshot of the commits parsed at the last successful sync

Read paths parse commits live from the local clone. A clone is not durable —
a fresh container or a recreated bind mount leaves a repo that syncs cleanly
and then renders an empty Commits table. These rows let that case fall back to
the last history we actually saw.

Revision ID: 0009
Revises: 0008
Create Date: 2026-09-15
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "commits",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "repo_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("repos.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("hash", sa.String(40), nullable=False),
        sa.Column("author_name", sa.String(255), nullable=False),
        sa.Column("author_email", sa.String(255), nullable=False),
        sa.Column("date", sa.DateTime(timezone=True), nullable=False),
        sa.Column("message", sa.Text(), nullable=False, server_default=""),
        sa.Column("branches", sa.JSON(), nullable=True),
        sa.Column("origin_branch", sa.String(255), nullable=False, server_default=""),
        sa.Column("insertions", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("deletions", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("files_changed", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint("repo_id", "hash", name="uq_commit_repo_hash"),
    )
    op.create_index("ix_commits_repo_id", "commits", ["repo_id"])
    op.create_index("ix_commits_author_email", "commits", ["author_email"])
    op.create_index("ix_commits_date", "commits", ["date"])


def downgrade() -> None:
    op.drop_index("ix_commits_date", table_name="commits")
    op.drop_index("ix_commits_author_email", table_name="commits")
    op.drop_index("ix_commits_repo_id", table_name="commits")
    op.drop_table("commits")
