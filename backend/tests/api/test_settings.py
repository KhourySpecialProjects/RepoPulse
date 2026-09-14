"""Tests for per-user application settings."""
from __future__ import annotations

import pytest
from httpx import AsyncClient

from app.services.llm.criteria import MAX_CRITERIA_CHARS


@pytest.mark.asyncio
async def test_commit_evaluation_criteria_defaults_to_empty(
    test_client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """No rubric until the instructor writes one.

    Empty is what keeps the classifier prompt identical to the one the
    accuracy gate measures, so this is a behavioural guarantee, not a detail.
    """
    response = await test_client.get("/api/v1/settings", headers=auth_headers)

    assert response.status_code == 200
    assert response.json()["commit_evaluation_criteria"] == ""


@pytest.mark.asyncio
async def test_criteria_round_trips_with_internal_formatting_preserved(
    test_client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    criteria = "Commits should be focused.\n\n  - Avoid direct pushes to main."

    response = await test_client.patch(
        "/api/v1/settings",
        headers=auth_headers,
        json={"commit_evaluation_criteria": criteria},
    )

    assert response.status_code == 200
    assert response.json()["commit_evaluation_criteria"] == criteria

    reread = await test_client.get("/api/v1/settings", headers=auth_headers)
    assert reread.json()["commit_evaluation_criteria"] == criteria


@pytest.mark.asyncio
async def test_criteria_can_be_cleared(
    test_client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """Clearing the rubric is legitimate — it returns to the built-in criteria."""
    await test_client.patch(
        "/api/v1/settings",
        headers=auth_headers,
        json={"commit_evaluation_criteria": "Be specific."},
    )

    response = await test_client.patch(
        "/api/v1/settings",
        headers=auth_headers,
        json={"commit_evaluation_criteria": ""},
    )

    assert response.status_code == 200
    assert response.json()["commit_evaluation_criteria"] == ""


@pytest.mark.asyncio
async def test_explicit_null_clears_rather_than_erroring(
    test_client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """A null must not reach a NOT NULL column as a 500."""
    response = await test_client.patch(
        "/api/v1/settings",
        headers=auth_headers,
        json={"commit_evaluation_criteria": None},
    )

    assert response.status_code == 200
    assert response.json()["commit_evaluation_criteria"] == ""


@pytest.mark.asyncio
async def test_criteria_over_the_cap_is_rejected(
    test_client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """The rubric is re-sent with every chunk, so its length is a cost multiplier."""
    response = await test_client.patch(
        "/api/v1/settings",
        headers=auth_headers,
        json={"commit_evaluation_criteria": "x" * (MAX_CRITERIA_CHARS + 1)},
    )

    assert response.status_code == 422


@pytest.mark.asyncio
async def test_omitting_criteria_leaves_it_untouched(
    test_client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    original = "Commits should represent one logical change."
    await test_client.patch(
        "/api/v1/settings",
        headers=auth_headers,
        json={"commit_evaluation_criteria": original},
    )

    response = await test_client.patch(
        "/api/v1/settings",
        headers=auth_headers,
        json={"llm_provider": "anthropic"},
    )

    assert response.status_code == 200
    assert response.json()["commit_evaluation_criteria"] == original
