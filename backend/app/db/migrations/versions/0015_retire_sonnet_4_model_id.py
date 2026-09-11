"""repoint app_settings rows off the retired claude-sonnet-4-20250514 model id

Changing the column default only affects rows created after this migration.
Existing rows carry the retired id as data, and every route reads it in
preference to the default (`user_settings.llm_model or DEFAULT_LLM_MODEL`) —
so without this update, existing users keep getting 404s from the API while a
freshly seeded database works fine.

Only rows still holding the retired id are touched; a user who deliberately
chose another model keeps it.

Revision ID: 0015
Revises: 0014
Create Date: 2026-09-10
"""
from __future__ import annotations

from alembic import op

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None

RETIRED = "claude-sonnet-4-20250514"
REPLACEMENT = "claude-sonnet-5"


def upgrade() -> None:
    op.execute(
        f"UPDATE app_settings SET llm_model = '{REPLACEMENT}' "
        f"WHERE llm_model = '{RETIRED}'"
    )


def downgrade() -> None:
    # Not a perfect inverse: a user who had independently chosen the
    # replacement model is moved onto the retired id. Acceptable, because the
    # alternative is recording per-row history for a value the user can change
    # from the settings page at any time.
    op.execute(
        f"UPDATE app_settings SET llm_model = '{RETIRED}' "
        f"WHERE llm_model = '{REPLACEMENT}'"
    )
