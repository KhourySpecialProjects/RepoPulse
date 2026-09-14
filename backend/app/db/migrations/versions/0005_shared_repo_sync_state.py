"""shared sync state on repos

A sync used to be visible only to the browser that started it: the spinner was
local React state on a five-second timer. If a TA kicked off a sync, the
instructor's dashboard showed the repo sitting idle while a clone ran.

These four columns move that state onto the repo, so every member of the
collection reads the same thing — including *who* started it.

`sync_started_by_id` is ON DELETE SET NULL rather than CASCADE: removing a user
must not take the repo with it, and an orphaned "someone is syncing this" is
still truthful.

Revision ID: 0005
Revises: 0004
Create Date: 2026-09-14
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None

SYNC_STATUS = sa.Enum("idle", "syncing", "failed", name="syncstatus")


def upgrade() -> None:
    # Created explicitly. `add_column` with an inline Enum emits the CREATE
    # TYPE on some paths and not others; doing it here keeps the downgrade
    # symmetrical, which the baseline migration notes was a problem before.
    SYNC_STATUS.create(op.get_bind(), checkfirst=True)

    op.add_column(
        "repos",
        sa.Column(
            "sync_status",
            SYNC_STATUS,
            nullable=False,
            server_default="idle",
        ),
    )
    op.add_column(
        "repos",
        sa.Column("sync_started_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "repos",
        sa.Column(
            "sync_started_by_id", postgresql.UUID(as_uuid=True), nullable=True
        ),
    )
    op.add_column("repos", sa.Column("sync_error", sa.String(500), nullable=True))

    op.create_foreign_key(
        "fk_repos_sync_started_by_id",
        "repos",
        "users",
        ["sync_started_by_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_repos_sync_started_by_id", "repos", type_="foreignkey")
    op.drop_column("repos", "sync_error")
    op.drop_column("repos", "sync_started_by_id")
    op.drop_column("repos", "sync_started_at")
    op.drop_column("repos", "sync_status")
    SYNC_STATUS.drop(op.get_bind(), checkfirst=True)
