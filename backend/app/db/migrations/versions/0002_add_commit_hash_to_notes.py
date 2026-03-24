"""add commit_hash to notes

Revision ID: 0002
Revises: 0001
Create Date: 2026-03-21 00:00:00.000000
"""
from __future__ import annotations
import sqlalchemy as sa
from alembic import op

revision = '0002'
down_revision = '0001'
branch_labels = None
depends_on = None

def upgrade() -> None:
    op.add_column('notes', sa.Column('commit_hash', sa.String(40), nullable=True))

def downgrade() -> None:
    op.drop_column('notes', 'commit_hash')
