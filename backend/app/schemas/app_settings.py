from __future__ import annotations

import uuid
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.services.llm.criteria import MAX_CRITERIA_CHARS


class AppSettingsRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_id: uuid.UUID
    repo_root_directory: str
    llm_provider: str
    llm_model: str
    health_thresholds: Optional[dict] = None
    anthropic_api_key_configured: bool = False
    ollama_base_url: Optional[str] = None
    commit_evaluation_criteria: str = ""


class AppSettingsUpdate(BaseModel):
    repo_root_directory: Optional[str] = None
    llm_provider: Optional[str] = None
    llm_model: Optional[str] = None
    health_thresholds: Optional[dict] = None
    anthropic_api_key: Optional[str] = None
    ollama_base_url: Optional[str] = None
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
