"""repoint app_settings rows off the retired claude-sonnet-4-20250514 model id

Carried forward from the pre-squash chain (was revision 0015). A no-op on a
freshly created database, kept because it is the only data migration in the
history and dropping it would silently strip the fix from any environment
replaying the chain.

Changing the column default only affects rows created after this migration.
Existing rows carry the retired id as data, and every route reads it in
preference to the default (`user_settings.llm_model or DEFAULT_LLM_MODEL`) —
so without this update, existing users keep getting 404s from the API while a
freshly seeded database works fine.

Only rows still holding the retired id are touched; a user who deliberately
chose another model keeps it.

Revision ID: 0002
Revises: 0001
Create Date: 2026-09-11
"""
from __future__ import annotations

from alembic import op

revision = "0002"
down_revision = "0001"
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
