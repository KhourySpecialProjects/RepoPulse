from __future__ import annotations

import uuid
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.services.llm.criteria import MAX_CRITERIA_CHARS


class AppSettingsRead(BaseModel):
    """Per-user settings.

    No provider, no API key and no writable model: those are instance-wide and
    administrator-only as of migration 0010 (see schemas/llm_quota.py).
    `llm_model` survives as read-only, so the Settings page can name the model
    it is about to use without holding admin rights.
    """

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_id: uuid.UUID
    repo_root_directory: str
    health_thresholds: Optional[dict] = None
    commit_evaluation_criteria: str = ""
    #: Read-only. Set by an administrator; PATCH /settings ignores it.
    llm_model: str = ""


class AppSettingsUpdate(BaseModel):
    """What a user may change about their own settings.

    Pydantic ignores unknown keys, so a client still sending the old
    `anthropic_api_key` or `llm_model` gets a 200 with those fields dropped
    rather than a 422. That is the intended outcome: the key is no longer
    theirs to set, and failing the whole request would break their attempt to
    save the rubric alongside it.
    """

    repo_root_directory: Optional[str] = None
    health_thresholds: Optional[dict] = None
    commit_evaluation_criteria: Optional[str] = Field(
        default=None, max_length=MAX_CRITERIA_CHARS
    )

    @field_validator("commit_evaluation_criteria")
    @classmethod
    def _null_clears_the_rubric(cls, value: str | None) -> str:
        """An explicit null means "no rubric", not NULL into a NOT NULL column.

        exclude_unset already drops the key when the client omits it, so this
        only ever fires on a deliberate null — and a 500 there would be a much
        worse answer than the obvious one.
        """
        return value or ""
