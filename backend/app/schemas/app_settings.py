from __future__ import annotations

import uuid
from typing import Optional

from pydantic import BaseModel, ConfigDict


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


class AppSettingsUpdate(BaseModel):
    repo_root_directory: Optional[str] = None
    llm_provider: Optional[str] = None
    llm_model: Optional[str] = None
    health_thresholds: Optional[dict] = None
    anthropic_api_key: Optional[str] = None
    ollama_base_url: Optional[str] = None
