"""add anthropic_api_key and ollama_base_url to app_settings

Revision ID: 0005
Revises: 0004
Create Date: 2026-03-22
"""
from alembic import op
import sqlalchemy as sa

revision = '0005'
down_revision = '0004'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('app_settings', sa.Column('anthropic_api_key', sa.String(500), nullable=True))
    op.add_column('app_settings', sa.Column('ollama_base_url', sa.String(500), nullable=True))


def downgrade() -> None:
    op.drop_column('app_settings', 'ollama_base_url')
    op.drop_column('app_settings', 'anthropic_api_key')
