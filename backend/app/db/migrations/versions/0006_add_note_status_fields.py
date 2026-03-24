"""add is_checked and is_archived to notes

Revision ID: 0006
Revises: 0005
Create Date: 2026-03-23
"""
from alembic import op
import sqlalchemy as sa

revision = '0006'
down_revision = '0005'
branch_labels = None
depends_on = None

def upgrade() -> None:
    op.add_column('notes', sa.Column('is_checked', sa.Boolean(), nullable=False, server_default='false'))
    op.add_column('notes', sa.Column('is_archived', sa.Boolean(), nullable=False, server_default='false'))

def downgrade() -> None:
    op.drop_column('notes', 'is_archived')
    op.drop_column('notes', 'is_checked')
