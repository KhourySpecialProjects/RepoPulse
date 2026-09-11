"""The default LLM model lives in exactly one place.

Eight copies of "claude-sonnet-4-20250514" were scattered across models,
routes, the adapter, the seed script and the eval harness. When the API retired
that model, every LLM feature in the app started returning 404 at once and
nothing in the codebase pointed at why. One constant, one edit.
"""
from __future__ import annotations

import re
from pathlib import Path

from app.core.config import settings
from app.models.app_settings import AppSettings

BACKEND_ROOT = Path(__file__).resolve().parents[1]

# config.py is where the literal belongs; everything else must reference it.
_ALLOWED = {BACKEND_ROOT / "app/core/config.py"}

# Migrations are exempt on purpose. A data migration records a specific
# historical value — "rows holding X become Y" — and must keep saying that
# after the constant moves on, or replaying history stops reproducing it.
_EXEMPT_DIRS = (BACKEND_ROOT / "app/db/migrations",)

_MODEL_LITERAL = re.compile(r'["\']claude-[a-z0-9.\-]+["\']')


def _is_exempt(path: Path) -> bool:
    return path in _ALLOWED or any(d in path.parents for d in _EXEMPT_DIRS)


def test_default_model_is_configured() -> None:
    assert settings.DEFAULT_LLM_MODEL
    assert settings.DEFAULT_LLM_PROVIDER == "anthropic"


def test_app_settings_default_tracks_the_constant() -> None:
    """A new user's settings row must not be born pinned to a stale model."""
    column_default = AppSettings.__table__.c.llm_model.default
    assert column_default.arg == settings.DEFAULT_LLM_MODEL


def test_no_module_hardcodes_a_model_id() -> None:
    offenders: list[str] = []
    for directory in ("app", "scripts"):
        for path in (BACKEND_ROOT / directory).rglob("*.py"):
            if _is_exempt(path):
                continue
            for match in _MODEL_LITERAL.finditer(path.read_text()):
                offenders.append(f"{path.relative_to(BACKEND_ROOT)}: {match.group(0)}")

    assert not offenders, (
        "model ids must come from settings.DEFAULT_LLM_MODEL, not literals:\n  "
        + "\n  ".join(offenders)
    )
