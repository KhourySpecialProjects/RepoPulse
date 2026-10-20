"""per-user Linear API key and per-repo Linear team link

`users.linear_api_key` mirrors `users.github_token`: each user brings their own
key, and the Linear panel reads the viewer's workspace with it.

`repos.linear_team_id` is the team someone picked for the repo. NULL is the
normal state, not a missing value — it means the panel matches a team by repo
name instead. Both columns are nullable with no default, so no existing row
changes meaning.

Revision ID: 0014
Revises: 0013
Create Date: 2026-10-20
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("linear_api_key", sa.Text(), nullable=True))
    op.add_column(
        "repos", sa.Column("linear_team_id", sa.String(length=64), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("repos", "linear_team_id")
    op.drop_column("users", "linear_api_key")
