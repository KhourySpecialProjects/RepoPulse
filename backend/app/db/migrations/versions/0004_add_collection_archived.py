"""add is_archived to collections

Revision ID: 0004
Revises: 0003
Create Date: 2026-03-22
"""
from alembic import op
import sqlalchemy as sa

revision = '0004'
down_revision = '0003'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'collections',
        sa.Column('is_archived', sa.Boolean(), nullable=False, server_default='false'),
    )


def downgrade() -> None:
    op.drop_column('collections', 'is_archived')
