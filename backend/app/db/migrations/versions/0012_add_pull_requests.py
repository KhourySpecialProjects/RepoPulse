"""add pull_requests table

Revision ID: 0012
Revises: 0011
Create Date: 2026-03-29
"""
from __future__ import annotations

import uuid
from alembic import op
import sqlalchemy as sa

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "pull_requests",
        sa.Column("id", sa.UUID(), primary_key=True, default=uuid.uuid4),
        sa.Column(
            "repo_id",
            sa.UUID(),
            sa.ForeignKey("repos.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("pr_number", sa.Integer(), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("state", sa.String(20), nullable=False),
        sa.Column("author_login", sa.String(255), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("merged_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("html_url", sa.Text(), nullable=False, server_default=""),
        sa.Column("reviews_requested", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("draft", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("fetched_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("repo_id", "pr_number", name="uq_pull_request_repo_number"),
        if_not_exists=True,
    )
    op.create_index(
        "ix_pull_requests_repo_id",
        "pull_requests",
        ["repo_id"],
        if_not_exists=True,
    )


def downgrade() -> None:
    op.drop_index("ix_pull_requests_repo_id", table_name="pull_requests")
    op.drop_table("pull_requests")
