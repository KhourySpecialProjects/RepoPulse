"""Tests for participation health signal — written first per TDD convention."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app.services.health_service import HealthService


@pytest.fixture
def svc() -> HealthService:
    return HealthService()


def _commit(
    days_ago: int = 1,
    email: str = "alice@example.com",
    message: str = "Add feature to improve user experience",
) -> dict:
    return {
        "hash": "abc123",
        "author_name": "Alice",
        "author_email": email,
        "date": datetime.now(timezone.utc) - timedelta(days=days_ago),
        "message": message,
        "branch": "main",
        "insertions": 10,
        "deletions": 2,
        "files_changed": 3,
    }


# ---------------------------------------------------------------------------
# _participation_score unit tests
# ---------------------------------------------------------------------------


def test_participation_score_green_exact(svc: HealthService) -> None:
    """actual == expected → ratio 1.0 → score 2."""
    assert svc._participation_score(4, 4) == 2


def test_participation_score_green_exceeds(svc: HealthService) -> None:
    """actual > expected → ratio > 1.0 → score 2."""
    assert svc._participation_score(5, 4) == 2


def test_participation_score_yellow(svc: HealthService) -> None:
    """actual == 60% of expected → ratio 0.6 → score 1."""
    assert svc._participation_score(3, 5) == 1


def test_participation_score_yellow_just_above_threshold(svc: HealthService) -> None:
    """actual == 70% of expected → score 1."""
    assert svc._participation_score(7, 10) == 1


def test_participation_score_red(svc: HealthService) -> None:
    """actual < 60% of expected → score 0."""
    assert svc._participation_score(2, 5) == 0


def test_participation_score_zero_actual(svc: HealthService) -> None:
    """No actual contributors → score 0."""
    assert svc._participation_score(0, 4) == 0


# ---------------------------------------------------------------------------
# compute_health with participation params
# ---------------------------------------------------------------------------


def test_compute_health_without_participation_omits_key(svc: HealthService) -> None:
    """Without expected_contributor_count, participation is None and composite uses 5 signals."""
    commits = [_commit()]
    result = svc.compute_health(commits, ["main"])
    assert result["participation"] is None
    # With 5 signals, max_sum = 10; verify composite is within [0, 1]
    assert 0.0 <= result["composite"] <= 1.0


def test_compute_health_with_participation_uses_6_signals(svc: HealthService) -> None:
    """With expected_contributor_count set, composite uses 6 signals (max_sum=12)."""
    commits = [_commit(email="alice@ex.com"), _commit(email="bob@ex.com")]
    result = svc.compute_health(
        commits,
        ["main"],
        expected_contributor_count=2,
        actual_contributor_count=2,
    )
    assert result["participation"] == 2.0
    # composite = raw_sum / 12; all signals: cf=0, rec=2, dist=0 (single-contributor edge), branch=1, msg=2, part=2
    # Just verify it's a float in range and participation is included
    assert 0.0 <= result["composite"] <= 1.0
    assert "participation" in result


def test_compute_health_participation_green(svc: HealthService) -> None:
    """actual >= expected → participation=2."""
    commits = [_commit(email=f"user{i}@ex.com") for i in range(4)]
    result = svc.compute_health(
        commits,
        ["main"],
        expected_contributor_count=4,
        actual_contributor_count=4,
    )
    assert result["participation"] == 2.0


def test_compute_health_participation_red(svc: HealthService) -> None:
    """actual < 60% of expected → participation=0."""
    commits = [_commit(email="alice@ex.com")]
    result = svc.compute_health(
        commits,
        ["main"],
        expected_contributor_count=5,
        actual_contributor_count=1,
    )
    assert result["participation"] == 0.0


def test_compute_health_participation_infers_actual_from_commits(svc: HealthService) -> None:
    """When actual_contributor_count is None, it infers from commit emails."""
    commits = [
        _commit(email="alice@ex.com"),
        _commit(email="bob@ex.com"),
        _commit(email="alice@ex.com"),  # duplicate; should be deduplicated
    ]
    result = svc.compute_health(
        commits,
        ["main"],
        expected_contributor_count=2,
        actual_contributor_count=None,
    )
    # 2 unique emails, expected 2 → score 2
    assert result["participation"] == 2.0


def test_compute_health_participation_normalises_email_case(svc: HealthService) -> None:
    """Email deduplication is case-insensitive."""
    commits = [
        _commit(email="Alice@Ex.com"),
        _commit(email="alice@ex.com"),
    ]
    result = svc.compute_health(
        commits,
        ["main"],
        expected_contributor_count=2,
        actual_contributor_count=None,
    )
    # Only 1 unique email after lowercasing → 1/2 = 0.5 < 0.6 → score 0
    assert result["participation"] == 0.0


def test_compute_health_result_keys_include_participation(svc: HealthService) -> None:
    """Result dict always includes 'participation' key."""
    result = svc.compute_health([_commit()], ["main"])
    assert "participation" in result


def test_compute_health_6signal_composite_all_green(svc: HealthService) -> None:
    """With all 6 signals green, composite should be 1.0."""
    commits = (
        [_commit(days_ago=i % 27 + 1, email="alice@ex.com", message="Add feature for user auth flow") for i in range(20)]
        + [_commit(days_ago=i % 27 + 1, email="bob@ex.com", message="Refactor database query logic here") for i in range(20)]
    )
    result = svc.compute_health(
        commits,
        ["main", "dev"],
        expected_contributor_count=2,
        actual_contributor_count=2,
    )
    assert result["status"] == "green"
    assert result["composite"] == 1.0
