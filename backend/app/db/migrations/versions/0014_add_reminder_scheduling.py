"""add remind_at to notes and reminder notification type

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
    op.add_column(
        "notes",
        sa.Column("remind_at", sa.DateTime(timezone=True), nullable=True),
    )
    # Reminders are queried by due date on every notification poll.
    op.create_index(
        "ix_notes_remind_at",
        "notes",
        ["remind_at"],
        postgresql_where=sa.text("is_reminder = true"),
    )
    # ADD VALUE cannot run inside a transaction block on PostgreSQL < 12, and
    # IF NOT EXISTS keeps this idempotent across re-runs.
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'reminder'")


def downgrade() -> None:
    op.drop_index("ix_notes_remind_at", table_name="notes")
    op.drop_column("notes", "remind_at")
    # PostgreSQL cannot drop a value from an enum type; the 'reminder' value is
    # left in place. Rows using it are removed with the notes they reference.
