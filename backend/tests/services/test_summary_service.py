"""Tests for SummaryService — uses mock LLM, never calls real API."""
from __future__ import annotations

import pytest

from app.services.llm.base import LLMService
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


# ---------------------------------------------------------------------------
# Token budgets
#
# max_tokens is a hard ceiling: when the model reaches it the reply is cut off
# mid-sentence. Each prompt asks for a paragraph range, so the ceiling has to
# sit well above that range or long summaries arrive truncated.
# ---------------------------------------------------------------------------


class _RecordingLLM(LLMService):
    """Captures the max_tokens each prompt was generated with."""

    def __init__(self) -> None:
        self.max_tokens: int | None = None

    async def generate(
        self,
        prompt: str,
        system: str | None = None,
        max_tokens: int = 1024,
    ) -> str:
        self.max_tokens = max_tokens
        return "ok"


@pytest.mark.asyncio
async def test_repo_overview_has_headroom_for_four_paragraphs() -> None:
    llm = _RecordingLLM()
    await SummaryService(llm=llm).generate_repo_overview({
        "name": "x", "github_url": "", "health_status": "unknown",
        "health_score": {}, "commits": [], "contributors": [],
    })
    # Asks for 2-4 paragraphs across five topics — roughly 650 tokens at the
    # top of that range, so the ceiling needs real headroom above it.
    assert llm.max_tokens is not None and llm.max_tokens >= 1500


@pytest.mark.asyncio
async def test_contributor_activity_has_headroom_for_three_paragraphs() -> None:
    llm = _RecordingLLM()
    await SummaryService(llm=llm).generate_contributor_activity({
        "display_name": "Alice", "repo_name": "x", "commits": [], "aliases": [],
    })
    assert llm.max_tokens is not None and llm.max_tokens >= 1000


@pytest.mark.asyncio
async def test_health_explanation_has_headroom_for_two_paragraphs() -> None:
    llm = _RecordingLLM()
    await SummaryService(llm=llm).generate_health_explanation({
        "repo_name": "x", "status": "green", "composite": 0.5,
        "commit_frequency": 1, "recency": 1, "distribution": 2,
        "branch_activity": 1, "commit_message_quality": 2,
    })
    assert llm.max_tokens is not None and llm.max_tokens >= 800
