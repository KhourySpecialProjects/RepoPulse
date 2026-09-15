"""one instance-wide LLM config, plus a measured per-user monthly token quota

Three changes, one theme: the model and the key that pays for it stop being a
per-user setting.

  * `llm_config` — a single row holding provider, model, key and the default
    monthly token allowance. Only administrators may read or write it.
  * `llm_token_usage` — one row per successful LLM call with the token counts
    the provider reported, which is what the quota sums.
  * `users.monthly_token_limit` — a nullable per-user override of that default.

The four LLM columns on `app_settings` are dropped rather than left unread.
Leaving them would mean a model id and an API key could each come from two
places, with nothing to say which won.

Note on downgrade: it restores the columns but not their contents. The keys in
particular are gone for good, which is the point — they are credentials that
this change makes unnecessary, and the backup for a real instance is the
database dump taken before upgrading, not this function.

Revision ID: 0010
Revises: 0009
Create Date: 2026-09-15
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None

# Kept in sync with models.llm_config.DEFAULT_MONTHLY_TOKEN_LIMIT. Spelled out
# rather than imported: a migration has to keep describing the schema it
# created even after the constant beside the model moves on.
DEFAULT_MONTHLY_TOKEN_LIMIT = 500_000


def upgrade() -> None:
    op.create_table(
        "llm_config",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "singleton",
            sa.Boolean(),
            nullable=False,
            server_default="true",
            unique=True,
        ),
        # No server default on either: the only writer is `get_llm_config`,
        # which supplies both from settings.DEFAULT_LLM_* — and a server
        # default here would be a second, silently stale source for the model
        # id that test_llm_model_default.py exists to prevent.
        sa.Column("llm_provider", sa.String(100), nullable=False),
        sa.Column("llm_model", sa.String(200), nullable=False),
        sa.Column("anthropic_api_key", sa.String(500), nullable=True),
        sa.Column("ollama_base_url", sa.String(500), nullable=True),
        sa.Column(
            "default_monthly_token_limit",
            sa.Integer(),
            nullable=False,
            server_default=str(DEFAULT_MONTHLY_TOKEN_LIMIT),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            # nullable=False to match what `Mapped[DateTime]` infers on the
            # model; the metadata-parity test in tests/test_migrations.py
            # compares nullability and would flag the difference.
            nullable=False,
        ),
        # Paired with the unique constraint above, this makes a second row
        # impossible: every row must carry singleton=true, and only one may.
        sa.CheckConstraint("singleton IS TRUE", name="ck_llm_config_singleton"),
    )

    op.create_table(
        "llm_token_usage",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("period", sa.String(7), nullable=False),
        sa.Column("feature", sa.String(50), nullable=False),
        sa.Column("model_used", sa.String(200), nullable=False),
        sa.Column("input_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("output_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("total_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_llm_token_usage_user_period",
        "llm_token_usage",
        ["user_id", "period"],
    )

    op.add_column(
        "users", sa.Column("monthly_token_limit", sa.Integer(), nullable=True)
    )

    # No seed row here on purpose. Whichever model an existing user had
    # selected is now only one user's preference among several, so there is no
    # defensible way to pick a winner from the old rows. `get_llm_config`
    # creates the row on first read from settings.DEFAULT_LLM_MODEL instead,
    # which also means a database restored from an older dump needs no repair —
    # and keeps the live model id out of a file that must keep describing 2026
    # forever.
    op.drop_column("app_settings", "anthropic_api_key")
    op.drop_column("app_settings", "ollama_base_url")
    op.drop_column("app_settings", "llm_provider")
    op.drop_column("app_settings", "llm_model")


def downgrade() -> None:
    # Restored nullable and empty: see the note in the module docstring.
    op.add_column(
        "app_settings", sa.Column("llm_model", sa.String(200), nullable=True)
    )
    op.add_column(
        "app_settings", sa.Column("llm_provider", sa.String(100), nullable=True)
    )
    op.add_column(
        "app_settings", sa.Column("ollama_base_url", sa.String(500), nullable=True)
    )
    op.add_column(
        "app_settings", sa.Column("anthropic_api_key", sa.String(500), nullable=True)
    )

    op.drop_column("users", "monthly_token_limit")
    op.drop_index("ix_llm_token_usage_user_period", table_name="llm_token_usage")
    op.drop_table("llm_token_usage")
    op.drop_table("llm_config")
