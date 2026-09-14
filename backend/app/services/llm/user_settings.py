"""Resolve a user's LLM configuration from AppSettings, with defaults.

This block was duplicated verbatim in commit_quality.py and summaries.py, and
the repo-level classify endpoint would have been a third copy. Keeping it in
one place matters because the fallbacks are load-bearing: a user with no
AppSettings row must still get a working provider/model pair, and
`settings.DEFAULT_LLM_MODEL` is the single line that changes when a model is
retired (see migration 0015).
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.app_settings import AppSettings


@dataclass(frozen=True)
class LLMSettings:
    provider: str
    model: str
    api_key: str | None
    ollama_url: str | None

    @property
    def label(self) -> str:
        """What gets written to `model_used`.

        Ollama models are namespaced so a row's provenance is unambiguous when
        the same model name exists on two providers.
        """
        return f"ollama/{self.model}" if self.provider == "ollama" else self.model


async def resolve_llm_settings(db: AsyncSession, user_id: uuid.UUID) -> LLMSettings:
    """The user's LLM config, falling back to environment defaults.

    Each field falls back independently: a row with a provider but a blank
    model still gets the default model rather than an empty string.
    """
    result = await db.execute(
        select(AppSettings).where(AppSettings.user_id == user_id)
    )
    user_settings = result.scalar_one_or_none()

    if user_settings is None:
        return LLMSettings(
            provider=settings.DEFAULT_LLM_PROVIDER,
            model=settings.DEFAULT_LLM_MODEL,
            api_key=None,
            ollama_url=None,
        )

    return LLMSettings(
        provider=user_settings.llm_provider or settings.DEFAULT_LLM_PROVIDER,
        model=user_settings.llm_model or settings.DEFAULT_LLM_MODEL,
        api_key=user_settings.anthropic_api_key or None,
        ollama_url=user_settings.ollama_base_url or None,
    )
