"""The green/yellow cutoffs behind each health signal.

These lived as literals inside `HealthService`, which made "healthy" a fixed
judgement about how a class should work. A team that commits in bursts around
deadlines is not unhealthy, so the boundaries belong to whoever is running the
course. Collections carry an override; this module holds the defaults and the
merge that turns a partial override into a complete set.

Each signal has a `green` and a `yellow` bound. Which direction is "better"
differs per signal — more commits per week is good, fewer days since the last
one is good — and that asymmetry stays in `HealthService`, which does the
comparing. This module only supplies numbers.
"""
from __future__ import annotations

from copy import deepcopy
from typing import Any

#: Signals scored 0/1/2, in the order the UI lists them.
SIGNAL_KEYS: tuple[str, ...] = (
    "commit_frequency",
    "recency",
    "distribution",
    "branch_activity",
    "commit_message_quality",
    "participation",
)

#: Reproduces exactly what `HealthService` hardcoded before this existed, so
#: adopting configurable thresholds does not itself recolour any repo.
DEFAULT_HEALTH_THRESHOLDS: dict[str, dict[str, float]] = {
    # Commits per week, averaged over the last four weeks. Higher is better.
    "commit_frequency": {"green": 10.0, "yellow": 4.0},
    # Days since the most recent commit. Lower is better.
    "recency": {"green": 3.0, "yellow": 7.0},
    # Gini coefficient of commits per contributor. Lower is more even.
    "distribution": {"green": 0.35, "yellow": 0.60},
    # Count of active branches. Higher is better.
    "branch_activity": {"green": 2.0, "yellow": 1.0},
    # Fraction of commits with low-quality messages. Lower is better.
    "commit_message_quality": {"green": 0.10, "yellow": 0.30},
    # Actual contributors over expected. Higher is better.
    "participation": {"green": 1.0, "yellow": 0.6},
    # Weighted average of the signals above, deciding the overall badge.
    "composite": {"green": 0.75, "yellow": 0.375},
}

_ALL_KEYS: tuple[str, ...] = SIGNAL_KEYS + ("composite",)


def _as_number(value: Any) -> float | None:
    """Coerce a stored value to a float, or None if it is not usable.

    `bool` is rejected explicitly: it is a subclass of `int`, so `True` would
    otherwise sail through as 1.0 and quietly become a threshold.
    """
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value)


def resolve_thresholds(stored: Any) -> dict[str, dict[str, float]]:
    """Merge a stored override over the defaults, field by field.

    Deliberately forgiving. The override is free-form JSON in a column no
    database constraint guards, and it is consumed inside repo indexing — a
    malformed value should cost the repo its custom cutoff, not abort the sync
    and leave it unscored. Anything unrecognised falls back to the default.
    """
    resolved = deepcopy(DEFAULT_HEALTH_THRESHOLDS)
    if not isinstance(stored, dict):
        return resolved

    for key in _ALL_KEYS:
        override = stored.get(key)
        if not isinstance(override, dict):
            continue
        for bound in ("green", "yellow"):
            number = _as_number(override.get(bound))
            if number is not None:
                resolved[key][bound] = number

    return resolved
