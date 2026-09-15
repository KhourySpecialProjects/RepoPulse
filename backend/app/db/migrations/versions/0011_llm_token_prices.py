"""admin-set token prices, so the cost figure is arithmetic rather than a guess

Migration 0010 started recording real token counts per call. That makes a cost
figure possible for the first time — but only the tokens are measured, and a
price still has to come from somewhere.

These two columns are that somewhere. They are nullable and unseeded on
purpose: a built-in price table would go stale the next time Anthropic changes
its list prices, silently, with the resulting dollar figure still reading as
measured. NULL means "no rates set" and the UI says cost is unavailable, which
is the honest state for an instance whose operator has not entered them.

Numeric(12, 4) rather than a float: these multiply into money, and binary
floating point holds neither 3.00 nor 0.80 exactly.

Revision ID: 0011
Revises: 0010
Create Date: 2026-09-15
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "llm_config",
        sa.Column("input_price_per_mtok", sa.Numeric(12, 4), nullable=True),
    )
    op.add_column(
        "llm_config",
        sa.Column("output_price_per_mtok", sa.Numeric(12, 4), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("llm_config", "output_price_per_mtok")
    op.drop_column("llm_config", "input_price_per_mtok")
