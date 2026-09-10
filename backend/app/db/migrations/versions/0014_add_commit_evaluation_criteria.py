"""add professor-controlled commit evaluation criteria

Revision ID: 0014
Revises: 0013
Create Date: 2026-09-10
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None

_INITIAL_CRITERIA = """Evaluate commit messages for clarity and informativeness.

Score each commit as exactly one of: good, ok, or bad.
- good: clearly describes what changed and/or why.
- ok: somewhat descriptive but vague.
- bad: uninformative or a placeholder such as "fix", "update", "wip", or "done".

Use the commit information and diff as evidence, and use judgment rather than inventing requirements."""


def upgrade() -> None:
    op.add_column(
        "app_settings",
        sa.Column(
            "commit_evaluation_criteria",
            sa.Text(),
            nullable=False,
            server_default=_INITIAL_CRITERIA,
        ),
    )


def downgrade() -> None:
    op.drop_column("app_settings", "commit_evaluation_criteria")
