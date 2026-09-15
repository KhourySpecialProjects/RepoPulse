"""drop the email relay

Notifications are in-app only now, so the per-user relay credentials and the
`emailed_at` delivery stamp have nothing left to record.

Only the email half of 0004 is reversed. The repo-scoped notification types and
the `repo_id`/`subject`/`body` columns it added stay — those are what the
course-activity events are built on, and they were never about email.

Downgrading restores the schema but not the data: credentials are dropped with
the table, and `emailed_at` comes back NULL for every row.

Revision ID: 0007
Revises: 0006
Create Date: 2026-09-15
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column("notifications", "emailed_at")
    op.drop_table("notification_settings")


def downgrade() -> None:
    op.add_column(
        "notifications",
        sa.Column("emailed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_table(
        "notification_settings",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column(
            "email_enabled",
            sa.Boolean(),
            server_default="false",
            nullable=False,
        ),
        sa.Column(
            "transport", sa.String(20), server_default="smtp", nullable=False
        ),
        sa.Column("from_email", sa.String(255), nullable=True),
        sa.Column("from_name", sa.String(255), nullable=True),
        sa.Column("smtp_host", sa.String(255), nullable=True),
        sa.Column("smtp_port", sa.Integer(), nullable=True),
        sa.Column("smtp_username", sa.String(255), nullable=True),
        sa.Column("smtp_password", sa.String(500), nullable=True),
        sa.Column(
            "smtp_encryption",
            sa.String(20),
            server_default="starttls",
            nullable=False,
        ),
        sa.Column("resend_api_key", sa.String(500), nullable=True),
        sa.Column("subscribed_events", sa.JSON(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
