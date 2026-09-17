"""count provider requests per usage row, so call volume is a real number

The admin call-volume graph counted rows in `summaries` and
`commit_classifications` — one-per-artefact tables. Classifying 222 commits
reported 222 calls when the classifier had made six batched requests, and the
figure tracked how many commits a repo had rather than load on the provider.

Call volume now comes from `llm_token_usage`, which is already written from
measured provider responses. One thing was missing: a row is one *write*, and
a batching caller settles several requests in a single write. This column
records how many.

Backfill note. Existing rows are set to 1, which is a floor and not a
measurement — the true per-call count for work done before this column
existed was never recorded, and one row was at minimum one request
(`record_usage` declines to write a zero-token row). Token totals and the
quota built on them are unaffected; only the pre-0012 slice of the call graph
undercounts. An instance that wants an exact history can delete the rows
predating this migration, at the cost of the token history with them.

Revision ID: 0012
Revises: 0011
Create Date: 2026-09-15
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "llm_token_usage",
        sa.Column(
            "calls",
            sa.Integer(),
            nullable=False,
            server_default="1",
        ),
    )


def downgrade() -> None:
    op.drop_column("llm_token_usage", "calls")
