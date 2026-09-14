"""Health cutoffs are data, not literals buried in the scorer.

Every signal's green/yellow boundary was hardcoded inside
`health_service`, so "a repo is healthy" meant whatever one course's defaults
happened to be. A class that commits in bursts around deadlines is not
unhealthy, it is differently shaped, and the instructor is the only one who can
say where the lines belong.

These tests pin two things: the shipped defaults still reproduce the original
hardcoded behaviour exactly, and a partial override only moves the cutoff it
names.
"""
from __future__ import annotations

import pytest

from app.services.health_thresholds import (
    DEFAULT_HEALTH_THRESHOLDS,
    SIGNAL_KEYS,
    resolve_thresholds,
)


def test_defaults_cover_every_signal_and_the_composite() -> None:
    for key in SIGNAL_KEYS:
        assert key in DEFAULT_HEALTH_THRESHOLDS, key
        assert {"green", "yellow"} <= set(DEFAULT_HEALTH_THRESHOLDS[key])
    assert "composite" in DEFAULT_HEALTH_THRESHOLDS


def test_defaults_match_the_original_hardcoded_values() -> None:
    """If these drift, existing repos silently change colour."""
    d = DEFAULT_HEALTH_THRESHOLDS
    assert d["commit_frequency"] == {"green": 10.0, "yellow": 4.0}
    assert d["recency"] == {"green": 3.0, "yellow": 7.0}
    assert d["distribution"] == {"green": 0.35, "yellow": 0.60}
    assert d["branch_activity"] == {"green": 2.0, "yellow": 1.0}
    assert d["commit_message_quality"] == {"green": 0.10, "yellow": 0.30}
    assert d["participation"] == {"green": 1.0, "yellow": 0.6}
    assert d["composite"] == {"green": 0.75, "yellow": 0.375}


def test_none_resolves_to_the_defaults() -> None:
    assert resolve_thresholds(None) == DEFAULT_HEALTH_THRESHOLDS


def test_a_partial_override_leaves_other_signals_alone() -> None:
    """Stored settings only carry what was actually customised."""
    resolved = resolve_thresholds({"recency": {"green": 1.0, "yellow": 2.0}})

    assert resolved["recency"] == {"green": 1.0, "yellow": 2.0}
    assert resolved["commit_frequency"] == DEFAULT_HEALTH_THRESHOLDS["commit_frequency"]


def test_a_half_specified_signal_keeps_the_other_bound() -> None:
    """Editing only the green field must not wipe the yellow one."""
    resolved = resolve_thresholds({"recency": {"green": 1.0}})

    assert resolved["recency"]["green"] == 1.0
    assert resolved["recency"]["yellow"] == DEFAULT_HEALTH_THRESHOLDS["recency"]["yellow"]


def test_unknown_keys_are_ignored_rather_than_trusted() -> None:
    """Stored JSON is not schema-checked by the database."""
    resolved = resolve_thresholds({"not_a_signal": {"green": 1}, "recency": {"green": 2.0}})

    assert "not_a_signal" not in resolved
    assert resolved["recency"]["green"] == 2.0


def test_junk_values_fall_back_instead_of_crashing_a_sync() -> None:
    """A bad value must not take the whole indexing run down.

    These are edited by hand through an API; a string where a number belongs
    should degrade to the default for that bound, not raise mid-sync and leave
    the repo unscored.
    """
    resolved = resolve_thresholds(
        {"recency": {"green": "soon", "yellow": None}, "distribution": "nonsense"}
    )

    assert resolved["recency"] == DEFAULT_HEALTH_THRESHOLDS["recency"]
    assert resolved["distribution"] == DEFAULT_HEALTH_THRESHOLDS["distribution"]


def test_resolving_never_mutates_the_defaults() -> None:
    """The defaults are module-level; a shallow merge would poison them."""
    resolve_thresholds({"recency": {"green": 99.0}})

    assert DEFAULT_HEALTH_THRESHOLDS["recency"]["green"] == 3.0
