"""email relay settings, and repo-scoped notification events

Three related changes:

1. Five new `notification_type` values for course-activity events a professor
   cares about: a repo being added or removed, a repo's health falling into
   red, and pull requests opening or merging.

2. Columns on `notifications` to support those events. They are repo-scoped
   rather than note-scoped, so they have no note to derive display text from
   and carry their own `subject`/`body`. `emailed_at` records relay delivery.

3. `notification_settings`, holding each user's email relay credentials and
   the per-event subscription map that decides what gets emailed.

`ALTER TYPE ... ADD VALUE` runs inside Alembic's transaction here, which
Postgres has allowed since 12 (the server is 16). The new values are not
*used* by this migration, which is the part that would still be rejected.

Revision ID: 0003
Revises: 0002
Create Date: 2026-09-14
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None

NEW_NOTIFICATION_TYPES = (
    "repo_added",
    "repo_removed",
    "repo_health_declined",
    "pr_opened",
    "pr_merged",
)

ORIGINAL_NOTIFICATION_TYPES = ("mention", "note_comment", "reminder")


def upgrade() -> None:
    for value in NEW_NOTIFICATION_TYPES:
        op.execute(
            f"ALTER TYPE notification_type ADD VALUE IF NOT EXISTS '{value}'"
        )

    op.add_column(
        "notifications",
        sa.Column("repo_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_notifications_repo_id",
        "notifications",
        "repos",
        ["repo_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index("ix_notifications_repo_id", "notifications", ["repo_id"])
    op.add_column(
        "notifications", sa.Column("subject", sa.String(300), nullable=True)
    )
    op.add_column("notifications", sa.Column("body", sa.Text(), nullable=True))
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


def downgrade() -> None:
    op.drop_table("notification_settings")

    op.drop_column("notifications", "emailed_at")
    op.drop_column("notifications", "body")
    op.drop_column("notifications", "subject")
    op.drop_index("ix_notifications_repo_id", table_name="notifications")
    op.drop_constraint(
        "fk_notifications_repo_id", "notifications", type_="foreignkey"
    )
    op.drop_column("notifications", "repo_id")

    # Postgres cannot drop a value from an enum, so the type is rebuilt without
    # the new ones. Rows holding a retired type are deleted first: their
    # notifications describe repo events this schema no longer represents, and
    # there is no note-scoped type they could honestly be remapped to.
    retired = ", ".join(f"'{value}'" for value in NEW_NOTIFICATION_TYPES)
    op.execute(f"DELETE FROM notifications WHERE type::text IN ({retired})")

    kept = ", ".join(f"'{value}'" for value in ORIGINAL_NOTIFICATION_TYPES)
    op.execute("ALTER TYPE notification_type RENAME TO notification_type_old")
    op.execute(f"CREATE TYPE notification_type AS ENUM ({kept})")
    op.execute(
        "ALTER TABLE notifications ALTER COLUMN type TYPE notification_type "
        "USING type::text::notification_type"
    )
    op.execute("DROP TYPE notification_type_old")
