"""Resolve the LLM configuration for a request.

The provider, model and API key are instance-wide and admin-owned — see
models/llm_config.py. Only the grading rubric is still the user's own, so this
reads two rows and keeps the shape the three LLM routes already consume
(commit_quality.py, commit_classification.py, summaries.py), which is why the
module name and signature are unchanged.

The fallbacks are load-bearing: `settings.DEFAULT_LLM_MODEL` is the single
line that changes when a model is retired (see migration 0015), and a user
with no AppSettings row must still get a working provider/model pair.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.app_settings import AppSettings
from app.services.llm.criteria import criteria_fingerprint, normalize_criteria
from app.services.llm.quota import get_llm_config


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
    """The instance's LLM config, plus this user's grading rubric.

    Each field falls back independently: a config row with a blank model still
    gets the default model rather than an empty string.
    """
    config = await get_llm_config(db)

    result = await db.execute(
        select(AppSettings).where(AppSettings.user_id == user_id)
    )
    user_settings = result.scalar_one_or_none()

    return LLMSettings(
        provider=config.llm_provider or settings.DEFAULT_LLM_PROVIDER,
        model=config.llm_model or settings.DEFAULT_LLM_MODEL,
        # None, not "": the adapter reads that as "fall back to
        # ANTHROPIC_API_KEY", which is how a Compose install works with nobody
        # having opened the admin panel.
        api_key=config.anthropic_api_key or None,
        ollama_url=config.ollama_base_url or None,
        # Normalised on read, not on write: one call site, the DB keeps the
        # instructor's exact formatting, and the text that gets hashed is
        # provably the text that reaches the prompt.
        commit_evaluation_criteria=normalize_criteria(
            user_settings.commit_evaluation_criteria if user_settings else ""
        ),
    )
