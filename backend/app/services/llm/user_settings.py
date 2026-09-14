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
from app.services.llm.criteria import criteria_fingerprint, normalize_criteria


@dataclass(frozen=True)
class LLMSettings:
    provider: str
    model: str
    api_key: str | None
    ollama_url: str | None
    #: The instructor's rubric, normalised. Empty means no addendum — which
    #: is also what every score cached before this feature was graded under.
    commit_evaluation_criteria: str = ""

    @property
    def criteria_hash(self) -> str | None:
        """Which rubric a score graded under; see CommitClassification."""
        return criteria_fingerprint(self.commit_evaluation_criteria)

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
            commit_evaluation_criteria="",
        )

    return LLMSettings(
        provider=user_settings.llm_provider or settings.DEFAULT_LLM_PROVIDER,
        model=user_settings.llm_model or settings.DEFAULT_LLM_MODEL,
        api_key=user_settings.anthropic_api_key or None,
        ollama_url=user_settings.ollama_base_url or None,
        # Normalised on read, not on write: one call site, the DB keeps the
        # instructor's exact formatting, and the text that gets hashed is
        # provably the text that reaches the prompt.
        commit_evaluation_criteria=normalize_criteria(
            user_settings.commit_evaluation_criteria
        ),
    )
