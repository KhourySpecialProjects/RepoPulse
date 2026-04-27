"""Tests for last_commit_at on repo list and detail endpoints."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.contributor import Contributor
from app.models.repo import Repo


async def _create_collection(client: AsyncClient, headers: dict) -> str:
    resp = await client.post(
        "/api/v1/collections",
        headers=headers,
        json={
            "name": "LastCommit Test Coll",
            "local_folder_name": f"last-commit-test-{uuid.uuid4().hex[:6]}",
        },
    )
    assert resp.status_code == 201
    return resp.json()["id"]


async def _create_repo(client: AsyncClient, headers: dict, collection_id: str) -> dict:
    resp = await client.post(
        f"/api/v1/collections/{collection_id}/repos",
        headers=headers,
        json={"urls": ["https://github.com/octocat/Hello-World"]},
    )
    assert resp.status_code == 201
    return resp.json()[0]


@pytest.mark.asyncio
async def test_list_repos_returns_last_commit_at_field(
    test_client: AsyncClient, auth_headers: dict
) -> None:
    """list_repos response includes last_commit_at field (None when no commits)."""
    coll_id = await _create_collection(test_client, auth_headers)
    await _create_repo(test_client, auth_headers, coll_id)

    resp = await test_client.get(
        f"/api/v1/collections/{coll_id}/repos", headers=auth_headers
    )
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert len(items) == 1
    assert "last_commit_at" in items[0]
    assert items[0]["last_commit_at"] is None


@pytest.mark.asyncio
async def test_list_repos_last_commit_at_populated(
    test_client: AsyncClient,
    auth_headers: dict,
    db_session: AsyncSession,
) -> None:
    """last_commit_at is returned from the repo row when set."""
    coll_id = await _create_collection(test_client, auth_headers)
    repo_data = await _create_repo(test_client, auth_headers, coll_id)

    commit_time = datetime(2025, 3, 15, 10, 30, 0, tzinfo=timezone.utc)
    result = await db_session.get(Repo, uuid.UUID(repo_data["id"]))
    assert result is not None
    result.last_commit_at = commit_time
    await db_session.commit()

    resp = await test_client.get(
        f"/api/v1/collections/{coll_id}/repos", headers=auth_headers
    )
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert len(items) == 1
    assert items[0]["last_commit_at"] is not None
    returned_dt = datetime.fromisoformat(items[0]["last_commit_at"].replace("Z", "+00:00"))
    assert returned_dt.year == 2025
    assert returned_dt.month == 3
    assert returned_dt.day == 15
