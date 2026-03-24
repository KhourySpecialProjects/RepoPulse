"""add collection_access table

Revision ID: 0008
Revises: 0007
Create Date: 2026-03-23
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = '0008'
down_revision = '0007'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create enum type in postgres
    op.execute("""
        DO $$ BEGIN
            CREATE TYPE collection_role AS ENUM ('co_instructor', 'ta');
        EXCEPTION WHEN duplicate_object THEN null;
        END $$;
    """)

    op.create_table(
        'collection_access',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            'collection_id',
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey('collections.id', ondelete='CASCADE'),
            nullable=False,
        ),
        sa.Column(
            'user_id',
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey('users.id', ondelete='CASCADE'),
            nullable=False,
        ),
        sa.Column(
            'access_role',
            postgresql.ENUM('co_instructor', 'ta', name='collection_role', create_type=False),
            nullable=False,
        ),
        sa.Column(
            'created_at',
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )

    op.create_unique_constraint(
        'uq_collection_access_collection_user',
        'collection_access',
        ['collection_id', 'user_id'],
    )

    op.create_index(
        'ix_collection_access_collection_id',
        'collection_access',
        ['collection_id'],
    )
    op.create_index(
        'ix_collection_access_user_id',
        'collection_access',
        ['user_id'],
    )


def downgrade() -> None:
    op.drop_index('ix_collection_access_user_id', table_name='collection_access')
    op.drop_index('ix_collection_access_collection_id', table_name='collection_access')
    op.drop_constraint(
        'uq_collection_access_collection_user', 'collection_access', type_='unique'
    )
    op.drop_table('collection_access')
    op.execute("DROP TYPE collection_role")
