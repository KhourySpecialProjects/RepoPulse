"""Tests for per-user application settings."""
from __future__ import annotations

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_settings_exposes_default_commit_evaluation_criteria(
    test_client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    response = await test_client.get("/api/v1/settings", headers=auth_headers)

    assert response.status_code == 200
    assert response.json()["commit_evaluation_criteria"]


@pytest.mark.asyncio
async def test_settings_trims_and_persists_commit_evaluation_criteria(
    test_client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    criteria = "  Commits should be focused.\n\nAvoid direct pushes to main.  "

    response = await test_client.patch(
        "/api/v1/settings",
        headers=auth_headers,
        json={"commit_evaluation_criteria": criteria},
    )

    assert response.status_code == 200
    assert response.json()["commit_evaluation_criteria"] == criteria.strip()

    reread = await test_client.get("/api/v1/settings", headers=auth_headers)
    assert reread.json()["commit_evaluation_criteria"] == criteria.strip()


@pytest.mark.asyncio
async def test_empty_commit_evaluation_criteria_does_not_overwrite_saved_value(
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
        json={"commit_evaluation_criteria": " \t\n "},
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "Criteria required"

    reread = await test_client.get("/api/v1/settings", headers=auth_headers)
    assert reread.json()["commit_evaluation_criteria"] == original
