"""share a reminder with other users

Revision ID: 0016
Revises: 0015
Create Date: 2026-09-11
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0016"
down_revision = "0015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "reminder_shares",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "note_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("notes.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint("note_id", "user_id", name="uq_reminder_share_note_user"),
    )
    op.create_index("ix_reminder_shares_note_id", "reminder_shares", ["note_id"])
    op.create_index("ix_reminder_shares_user_id", "reminder_shares", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_reminder_shares_user_id", table_name="reminder_shares")
    op.drop_index("ix_reminder_shares_note_id", table_name="reminder_shares")
    op.drop_table("reminder_shares")
