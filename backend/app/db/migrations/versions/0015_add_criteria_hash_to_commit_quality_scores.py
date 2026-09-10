"""make commit quality cache rubric-aware

Revision ID: 0015
Revises: 0014
Create Date: 2026-09-10
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "commit_quality_scores",
        sa.Column("criteria_hash", sa.String(64), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("commit_quality_scores", "criteria_hash")
