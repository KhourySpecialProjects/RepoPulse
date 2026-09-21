"""Custom cutoffs actually move the pills.

The point of configurable thresholds is that an instructor can say what
"healthy" means for their course. These tests hold one repo's data fixed and
change only the thresholds, so any difference in score is attributable to the
setting rather than the data.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app.services.health_service import HealthService

service = HealthService()


def _commits(n: int, *, days_ago: float = 0.0, authors: int = 2) -> list[dict]:
    now = datetime.now(timezone.utc)
    return [
        {
            "date": now - timedelta(days=days_ago),
            "author_email": f"dev{i % authors}@example.com",
            "message": "a reasonably descriptive commit message",
        }
        for i in range(n)
    ]


def test_defaults_are_unchanged_by_passing_nothing() -> None:
    """Adopting thresholds must not recolour repos on its own."""
    commits = _commits(40)
    assert (
        service.compute_health(commits, ["main", "dev"])
        == service.compute_health(commits, ["main", "dev"], thresholds=None)
    )


def test_raising_the_frequency_bar_downgrades_a_repo() -> None:
    # 40 commits over 4 weeks = 10/week, exactly the default green cutoff.
    commits = _commits(40)
    assert service.compute_health(commits, ["main"])["commit_frequency"] == 2.0

    demanding = service.compute_health(
        commits, ["main"], thresholds={"commit_frequency": {"green": 20.0, "yellow": 15.0}}
    )
    assert demanding["commit_frequency"] == 0.0


def test_relaxing_recency_rescues_a_stale_repo() -> None:
    stale = _commits(4, days_ago=20)
    assert service.compute_health(stale, ["main"])["recency"] == 0.0

    forgiving = service.compute_health(
        stale, ["main"], thresholds={"recency": {"green": 30.0, "yellow": 60.0}}
    )
    assert forgiving["recency"] == 2.0


def test_the_composite_cutoffs_decide_the_badge() -> None:
    """Same signals, different badge, purely from the composite bounds."""
    commits = _commits(40)
    branches = ["main", "dev"]

    assert service.compute_health(commits, branches)["status"] == "green"

    strict = service.compute_health(
        commits, branches, thresholds={"composite": {"green": 1.01, "yellow": 1.0}}
    )
    assert strict["status"] == "red"


def test_a_partial_override_leaves_other_signals_scored_normally() -> None:
    commits = _commits(40)
    baseline = service.compute_health(commits, ["main", "dev"])
    tweaked = service.compute_health(
        commits, ["main", "dev"], thresholds={"recency": {"green": 0.0001}}
    )

    assert tweaked["commit_frequency"] == baseline["commit_frequency"]
    assert tweaked["distribution"] == baseline["distribution"]


def test_malformed_thresholds_do_not_break_scoring() -> None:
    """A bad setting must not abort the sync that computes health."""
    commits = _commits(40)

    result = service.compute_health(
        commits, ["main"], thresholds={"recency": {"green": "soon"}}
    )

    assert result["status"] in {"green", "yellow", "red"}
    # Fell back to the default cutoff rather than raising.
    assert result["recency"] == service.compute_health(commits, ["main"])["recency"]
