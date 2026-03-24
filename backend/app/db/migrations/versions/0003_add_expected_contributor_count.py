"""add expected_contributor_count to repos

Revision ID: 0003
Revises: 0002
Create Date: 2026-03-22
"""
from alembic import op
import sqlalchemy as sa

revision = '0003'
down_revision = '0002'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('repos', sa.Column('expected_contributor_count', sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column('repos', 'expected_contributor_count')
