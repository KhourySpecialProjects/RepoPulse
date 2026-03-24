"""Tests for SummaryService — uses mock LLM, never calls real API."""
from __future__ import annotations

import pytest

from app.services.summary_service import SummaryService


@pytest.fixture
def summary_svc(mock_llm) -> SummaryService:
    return SummaryService(llm=mock_llm)


@pytest.mark.asyncio
async def test_generate_repo_overview_returns_string(summary_svc: SummaryService) -> None:
    repo_data = {
        "name": "test-repo",
        "github_url": "https://github.com/test/test-repo",
        "health_status": "green",
        "health_score": {"composite": 0.9, "status": "green"},
        "commits": [],
        "contributors": [{"display_name": "Alice"}],
    }
    result = await summary_svc.generate_repo_overview(repo_data)
    assert isinstance(result, str)
    assert len(result) > 0


@pytest.mark.asyncio
async def test_generate_contributor_activity_returns_string(summary_svc: SummaryService) -> None:
    contributor_data = {
        "display_name": "Alice Johnson",
        "repo_name": "test-repo",
        "commits": [],
        "aliases": [{"git_name": "Alice", "git_email": "alice@example.com"}],
    }
    result = await summary_svc.generate_contributor_activity(contributor_data)
    assert isinstance(result, str)
    assert len(result) > 0


@pytest.mark.asyncio
async def test_generate_health_explanation_returns_string(summary_svc: SummaryService) -> None:
    health_data = {
        "repo_name": "test-repo",
        "status": "yellow",
        "composite": 0.5,
        "commit_frequency": 1,
        "recency": 1,
        "distribution": 2,
        "branch_activity": 1,
        "commit_message_quality": 2,
    }
    result = await summary_svc.generate_health_explanation(health_data)
    assert isinstance(result, str)
    assert len(result) > 0


@pytest.mark.asyncio
async def test_mock_llm_is_not_real(summary_svc: SummaryService) -> None:
    """Confirm mock returns fixture string, not a real LLM response."""
    result = await summary_svc.generate_repo_overview({
        "name": "x", "github_url": "", "health_status": "unknown",
        "health_score": {}, "commits": [], "contributors": [],
    })
    assert result == "This is a mock LLM response."
