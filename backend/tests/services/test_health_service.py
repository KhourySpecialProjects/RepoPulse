"""Tests for HealthService — written first per TDD convention."""
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
    branch: str = "main",
) -> dict:
    return {
        "hash": "abc123",
        "author_name": "Alice",
        "author_email": email,
        "date": datetime.now(timezone.utc) - timedelta(days=days_ago),
        "message": message,
        "branch": branch,
        "insertions": 10,
        "deletions": 2,
        "files_changed": 3,
    }


# ---------------------------------------------------------------------------
# Commit frequency
# ---------------------------------------------------------------------------


def test_commit_frequency_green(svc: HealthService) -> None:
    """40+ commits in 4 weeks → >= 10/week → score 2."""
    commits = [_commit(days_ago=i % 28) for i in range(40)]
    result = svc.compute_health(commits, ["main"])
    assert result["commit_frequency"] == 2.0


def test_commit_frequency_yellow(svc: HealthService) -> None:
    """20 commits in 4 weeks → 5/week → score 1."""
    commits = [_commit(days_ago=i % 27 + 1) for i in range(20)]
    result = svc.compute_health(commits, ["main"])
    assert result["commit_frequency"] == 1.0


def test_commit_frequency_red(svc: HealthService) -> None:
    """4 commits in 4 weeks → 1/week → score 0."""
    commits = [_commit(days_ago=i * 6 + 1) for i in range(4)]
    result = svc.compute_health(commits, ["main"])
    assert result["commit_frequency"] == 0.0


# ---------------------------------------------------------------------------
# Recency
# ---------------------------------------------------------------------------


def test_recency_green(svc: HealthService) -> None:
    """Last commit 1 day ago → score 2."""
    commits = [_commit(days_ago=1)]
    result = svc.compute_health(commits, ["main"])
    assert result["recency"] == 2.0


def test_recency_yellow(svc: HealthService) -> None:
    """Last commit 5 days ago → score 1."""
    commits = [_commit(days_ago=5)]
    result = svc.compute_health(commits, ["main"])
    assert result["recency"] == 1.0


def test_recency_red(svc: HealthService) -> None:
    """Last commit 10 days ago → score 0."""
    commits = [_commit(days_ago=10)]
    result = svc.compute_health(commits, ["main"])
    assert result["recency"] == 0.0


# ---------------------------------------------------------------------------
# Distribution
# ---------------------------------------------------------------------------


def test_distribution_green(svc: HealthService) -> None:
    """Equal commits from two contributors → low Gini → score 2."""
    commits = (
        [_commit(email="alice@ex.com") for _ in range(10)]
        + [_commit(email="bob@ex.com") for _ in range(10)]
    )
    result = svc.compute_health(commits, ["main"])
    assert result["distribution"] == 2.0


def test_distribution_red_single_contributor(svc: HealthService) -> None:
    """All commits from one person → score 0."""
    commits = [_commit(email="alice@ex.com") for _ in range(10)]
    result = svc.compute_health(commits, ["main"])
    assert result["distribution"] == 0.0


# ---------------------------------------------------------------------------
# Branch activity
# ---------------------------------------------------------------------------


def test_branch_activity_green(svc: HealthService) -> None:
    """Two branches → score 2."""
    result = svc.compute_health([_commit()], ["main", "feature/login"])
    assert result["branch_activity"] == 2.0


def test_branch_activity_red_no_branches(svc: HealthService) -> None:
    """No branches → score 0."""
    result = svc.compute_health([], [])
    assert result["branch_activity"] == 0.0


# ---------------------------------------------------------------------------
# Commit message quality
# ---------------------------------------------------------------------------


def test_message_quality_green(svc: HealthService) -> None:
    """All messages are descriptive → score 2."""
    commits = [_commit(message="Add new feature for user authentication flow") for _ in range(10)]
    result = svc.compute_health(commits, ["main"])
    assert result["commit_message_quality"] == 2.0


def test_message_quality_red(svc: HealthService) -> None:
    """All messages are single words → score 0."""
    commits = [_commit(message="fix") for _ in range(10)]
    result = svc.compute_health(commits, ["main"])
    assert result["commit_message_quality"] == 0.0


# ---------------------------------------------------------------------------
# Composite & status
# ---------------------------------------------------------------------------


def test_composite_green(svc: HealthService) -> None:
    """All signals green → composite >= 0.75 → status green."""
    # 40 recent commits, 2 contributors, 2 branches, long messages
    commits = (
        [_commit(days_ago=i % 27 + 1, email="alice@ex.com", message="Add feature for user auth") for i in range(20)]
        + [_commit(days_ago=i % 27 + 1, email="bob@ex.com", message="Refactor database query logic") for i in range(20)]
    )
    result = svc.compute_health(commits, ["main", "dev"])
    assert result["status"] == "green"
    assert result["composite"] >= 0.75


def test_composite_red(svc: HealthService) -> None:
    """No commits → all signals 0 → status red."""
    result = svc.compute_health([], [])
    assert result["status"] == "red"
    assert result["composite"] == 0.0


def test_composite_keys(svc: HealthService) -> None:
    """Result dict contains all expected keys including participation."""
    result = svc.compute_health([_commit()], ["main"])
    expected_keys = {
        "commit_frequency",
        "recency",
        "distribution",
        "branch_activity",
        "commit_message_quality",
        "participation",
        "composite",
        "status",
    }
    assert expected_keys == set(result.keys())
