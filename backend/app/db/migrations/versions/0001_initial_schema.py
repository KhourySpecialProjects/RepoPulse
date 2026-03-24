"""add contributor stats columns

Revision ID: 0001
Revises:
Create Date: 2026-03-21 00:00:00.000000

"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = '0001'
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('contributors', sa.Column('commit_count', sa.Integer(), nullable=False, server_default='0'))
    op.add_column('contributors', sa.Column('total_insertions', sa.Integer(), nullable=False, server_default='0'))
    op.add_column('contributors', sa.Column('total_deletions', sa.Integer(), nullable=False, server_default='0'))
    op.add_column('contributors', sa.Column('last_commit_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column('contributors', 'last_commit_at')
    op.drop_column('contributors', 'total_deletions')
    op.drop_column('contributors', 'total_insertions')
    op.drop_column('contributors', 'commit_count')
