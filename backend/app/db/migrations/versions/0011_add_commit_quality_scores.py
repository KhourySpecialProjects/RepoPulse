"""add commit_quality_scores table

Revision ID: 0011
Revises: 0010
Create Date: 2026-03-28
"""
from __future__ import annotations

import uuid
from alembic import op
import sqlalchemy as sa

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "commit_quality_scores",
        sa.Column("id", sa.UUID(), primary_key=True, default=uuid.uuid4),
        sa.Column("repo_id", sa.UUID(), sa.ForeignKey("repos.id", ondelete="CASCADE"), nullable=False),
        sa.Column("commit_hash", sa.String(40), nullable=False),
        sa.Column("score", sa.String(10), nullable=False),
        sa.Column("model_used", sa.String(100), nullable=False),
        sa.Column("scored_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("repo_id", "commit_hash", name="uq_commit_quality_repo_hash"),
        if_not_exists=True,
    )
    op.create_index("ix_commit_quality_scores_repo_id", "commit_quality_scores", ["repo_id"], if_not_exists=True)


def downgrade() -> None:
    op.drop_index("ix_commit_quality_scores_repo_id", table_name="commit_quality_scores")
    op.drop_table("commit_quality_scores")
