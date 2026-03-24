"""add note_comments table

Revision ID: 0009
Revises: 0008
Create Date: 2026-03-23
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = '0009'
down_revision = '0008'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'note_comments',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            'note_id',
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey('notes.id', ondelete='CASCADE'),
            nullable=False,
        ),
        sa.Column(
            'author_id',
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey('users.id', ondelete='CASCADE'),
            nullable=False,
        ),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column(
            'created_at',
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            'updated_at',
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )

    op.create_index('ix_note_comments_note_id', 'note_comments', ['note_id'])
    op.create_index('ix_note_comments_author_id', 'note_comments', ['author_id'])


def downgrade() -> None:
    op.drop_index('ix_note_comments_author_id', table_name='note_comments')
    op.drop_index('ix_note_comments_note_id', table_name='note_comments')
    op.drop_table('note_comments')
