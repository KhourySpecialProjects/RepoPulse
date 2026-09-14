"""add the instructor commit-evaluation rubric and its cache key

Restores the feature originally shipped in b8fcd5a and reverted by ff8500c.
The revert predates the migration squash (2ac84c8), so the original 0014/0015
no longer exist in the chain and could not be replayed — this is a fresh
forward migration covering both columns, because they are one feature and a
half-applied state would be worse than either end of it.

`app_settings.commit_evaluation_criteria` is NOT NULL and defaults to the
empty string, which is also what every existing row is backfilled with. Empty
means "no instructor addendum", so the classifier prompt for a user who never
opens the setting stays byte-identical to the one the accuracy gate in
tests/test_commit_classifier_eval.py measures. The server_default is kept
rather than dropped, matching pull_requests.author_login in 0001: the model
declares the same default on both sides, so raw SQL inserts cannot violate the
NOT NULL.

`commit_classifications.criteria_hash` is nullable on purpose. Every row that
exists today was scored under the old hardcoded rubric, and there is no honest
hash to backfill for them — the commit-quality route reads NULL as stale and
re-grades those commits once against whatever rubric is current.

Revision ID: 0003
Revises: 0002
Create Date: 2026-09-14
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None



def upgrade() -> None:
    op.add_column(
        "app_settings",
        sa.Column(
            "commit_evaluation_criteria",
            sa.Text(),
            nullable=False,
            server_default="",
        ),
    )

    op.add_column(
        "commit_classifications",
        sa.Column("criteria_hash", sa.String(64), nullable=True),
    )


def downgrade() -> None:
    # Lossy in one direction only: dropping criteria_hash discards which rubric
    # each cached score was graded under, so a re-upgrade treats every existing
    # score as stale and re-grades it. That is the safe direction to fail in.
    op.drop_column("commit_classifications", "criteria_hash")
    op.drop_column("app_settings", "commit_evaluation_criteria")
