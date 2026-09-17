"""single-use links so admins stop choosing other people's passwords

Creating a user used to mean the admin typing a password on that person's
behalf and then communicating it, and `POST /users/{id}/reset-password` did the
same thing again. Every account therefore had its password known to at least
two people, and the handover happened over whatever channel was nearest.

An account is now created with `users.password_hash` NULL — already nullable,
so this migration touches no existing column — plus a row here. The admin
passes the link on and the recipient sets their own password, which is the only
moment a password exists in readable form.

`token_hash` stores `sha256(raw)` rather than a bcrypt digest, because lookup
happens *by* the hash: bcrypt salts every call, so finding the matching row
would mean scanning the table and verifying each one. That trade is safe here
in a way it would not be for a password — the raw token is
`secrets.token_urlsafe(32)`, so there is no small candidate space to search.
Both halves of that reasoning matter: switching to bcrypt breaks lookup, and
shortening the token breaks the argument for sha256.

`used_at` marks a spent link instead of deleting the row, so a second click on
a link that already worked is answered deliberately rather than looking
identical to a token that never existed. The unique index on `token_hash` is
what makes a replayed hash a single indexed lookup.

Rows are removed with their user by the FK cascade; nothing else references
them.

Revision ID: 0013
Revises: 0012
Create Date: 2026-09-17
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "account_setup_tokens",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            nullable=False,
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_account_setup_tokens_user_id",
        "account_setup_tokens",
        ["user_id"],
    )
    # unique=True here rather than a UniqueConstraint: the model declares
    # `unique=True, index=True` on the column, which SQLAlchemy reflects as a
    # unique *index*. Same reasoning as ix_users_email in 0001.
    op.create_index(
        "ix_account_setup_tokens_token_hash",
        "account_setup_tokens",
        ["token_hash"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_account_setup_tokens_token_hash", table_name="account_setup_tokens"
    )
    op.drop_index(
        "ix_account_setup_tokens_user_id", table_name="account_setup_tokens"
    )
    op.drop_table("account_setup_tokens")
