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

    # The index and unique constraint may or may not exist under their old
    # names. A database built by migration 0011 has both; one built by
    # Base.metadata.create_all (app/main.py on startup, app/db/seed.py) has the
    # constraint — the old model declared it — but *not* the index, which only
    # ever existed in 0011. Rename what is there, create what is missing.
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM pg_class
                WHERE relname = 'ix_commit_quality_scores_repo_id'
                  AND relkind = 'i'
            ) THEN
                ALTER INDEX ix_commit_quality_scores_repo_id
                    RENAME TO ix_commit_classifications_repo_id;
            END IF;
        END $$;
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_commit_classifications_repo_id "
        "ON commit_classifications (repo_id)"
    )

    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conname = 'uq_commit_quality_repo_hash'
                  AND conrelid = 'commit_classifications'::regclass
            ) THEN
                ALTER TABLE commit_classifications
                    RENAME CONSTRAINT uq_commit_quality_repo_hash
                    TO uq_commit_classification_repo_hash;
            ELSIF NOT EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conname = 'uq_commit_classification_repo_hash'
                  AND conrelid = 'commit_classifications'::regclass
            ) THEN
                ALTER TABLE commit_classifications
                    ADD CONSTRAINT uq_commit_classification_repo_hash
                    UNIQUE (repo_id, commit_hash);
            END IF;
        END $$;
        """
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

    # Guarded for the same reason as upgrade(): the names present depend on
    # whether this database was built by migrations or by create_all.
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conname = 'uq_commit_classification_repo_hash'
                  AND conrelid = 'commit_classifications'::regclass
            ) THEN
                ALTER TABLE commit_classifications
                    RENAME CONSTRAINT uq_commit_classification_repo_hash
                    TO uq_commit_quality_repo_hash;
            END IF;
        END $$;
        """
    )
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM pg_class
                WHERE relname = 'ix_commit_classifications_repo_id'
                  AND relkind = 'i'
            ) THEN
                ALTER INDEX ix_commit_classifications_repo_id
                    RENAME TO ix_commit_quality_scores_repo_id;
            END IF;
        END $$;
        """
    )

    op.rename_table("commit_classifications", "commit_quality_scores")
