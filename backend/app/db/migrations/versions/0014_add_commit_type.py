"""rename commit_quality_scores to commit_classifications and add commit_type

Adds a Substantive/Logistical `commit_type` alongside the existing
message-quality `score`. The table is renamed because it now holds two
independent LLM-derived attributes rather than just a quality score.

Existing rows keep their score with commit_type = NULL until reclassified.

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


def upgrade() -> None:
    op.rename_table("commit_quality_scores", "commit_classifications")

    op.alter_column(
        "commit_classifications",
        "score",
        existing_type=sa.String(10),
        nullable=True,
    )
    op.add_column(
        "commit_classifications",
        sa.Column("commit_type", sa.String(20), nullable=True),
    )

    op.execute(
        "ALTER INDEX ix_commit_quality_scores_repo_id "
        "RENAME TO ix_commit_classifications_repo_id"
    )
    op.execute(
        "ALTER TABLE commit_classifications "
        "RENAME CONSTRAINT uq_commit_quality_repo_hash "
        "TO uq_commit_classification_repo_hash"
    )

    # Plain CHECKs rather than a PG ENUM — adding a value to an enum later
    # requires ALTER TYPE, which does not run inside a transaction cleanly.
    op.create_check_constraint(
        "ck_commit_classification_type",
        "commit_classifications",
        "commit_type IS NULL OR commit_type IN ('substantive', 'logistical')",
    )
    op.create_check_constraint(
        "ck_commit_classification_score",
        "commit_classifications",
        "score IS NULL OR score IN ('good', 'ok', 'bad')",
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_commit_classification_score", "commit_classifications", type_="check"
    )
    op.drop_constraint(
        "ck_commit_classification_type", "commit_classifications", type_="check"
    )

    op.drop_column("commit_classifications", "commit_type")

    # Restore NOT NULL on score. Any row typed but never scored would block
    # this, so backfill it to the neutral value the old code used.
    op.execute("UPDATE commit_classifications SET score = 'ok' WHERE score IS NULL")
    op.alter_column(
        "commit_classifications",
        "score",
        existing_type=sa.String(10),
        nullable=False,
    )

    op.execute(
        "ALTER TABLE commit_classifications "
        "RENAME CONSTRAINT uq_commit_classification_repo_hash "
        "TO uq_commit_quality_repo_hash"
    )
    op.execute(
        "ALTER INDEX ix_commit_classifications_repo_id "
        "RENAME TO ix_commit_quality_scores_repo_id"
    )

    op.rename_table("commit_classifications", "commit_quality_scores")
