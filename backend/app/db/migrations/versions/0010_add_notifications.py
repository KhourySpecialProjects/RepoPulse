"""add notifications table

Revision ID: 0010
Revises: 0009
Create Date: 2026-03-23
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = '0010'
down_revision = '0009'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create enum type in postgres
    op.execute("""
        DO $$ BEGIN
            CREATE TYPE notification_type AS ENUM ('mention', 'note_comment');
        EXCEPTION WHEN duplicate_object THEN null;
        END $$;
    """)

    op.create_table(
        'notifications',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            'recipient_id',
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey('users.id', ondelete='CASCADE'),
            nullable=False,
        ),
        sa.Column(
            'type',
            postgresql.ENUM('mention', 'note_comment', name='notification_type', create_type=False),
            nullable=False,
        ),
        sa.Column(
            'note_id',
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey('notes.id', ondelete='CASCADE'),
            nullable=True,
        ),
        sa.Column(
            'comment_id',
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey('note_comments.id', ondelete='CASCADE'),
            nullable=True,
        ),
        sa.Column(
            'is_read',
            sa.Boolean(),
            default=False,
            server_default='false',
            nullable=False,
        ),
        sa.Column(
            'created_at',
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )

    op.create_index('ix_notifications_recipient_id', 'notifications', ['recipient_id'])
    op.create_index('ix_notifications_is_read', 'notifications', ['is_read'])


def downgrade() -> None:
    op.drop_index('ix_notifications_is_read', table_name='notifications')
    op.drop_index('ix_notifications_recipient_id', table_name='notifications')
    op.drop_table('notifications')
    op.execute("DROP TYPE notification_type")
