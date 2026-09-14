"""record on-disk size per repo for the admin storage dashboard

Sizes are persisted rather than measured per request: walking full clones on
every dashboard load is unbounded work inside a request handler. The
dashboard renders size_computed_at alongside the number so a stale
measurement looks stale.

Revision ID: 0005
Revises: 0004
Create Date: 2026-09-14
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # BigInteger, not Integer. int4 caps at 2,147,483,647 bytes (~2 GiB) and
    # the PRD mandates full non-shallow clones, so a busy repo's .git passes
    # that. With Integer the write would fail with an out-of-range error on
    # the largest repo in the instance.
    #
    # Nullable with no server default: NULL distinguishes "never measured"
    # from a measured 0, which is what makes staleness reportable.
    op.add_column("repos", sa.Column("size_bytes", sa.BigInteger(), nullable=True))
    op.add_column("repos", sa.Column("git_size_bytes", sa.BigInteger(), nullable=True))
    op.add_column(
        "repos",
        sa.Column("size_computed_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("repos", "size_computed_at")
    op.drop_column("repos", "git_size_bytes")
    op.drop_column("repos", "size_bytes")
