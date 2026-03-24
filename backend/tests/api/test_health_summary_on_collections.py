"""Tests for health summary counts on collection endpoints (Feature 2)."""
from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.repo import Repo


async def _create_collection(client: AsyncClient, headers: dict, name: str = "Health Coll") -> dict:
    resp = await client.post(
        "/api/v1/collections",
        headers=headers,
        json={
            "name": name,
            "local_folder_name": f"health-test-{uuid.uuid4().hex[:6]}",
        },
    )
    assert resp.status_code == 201
    return resp.json()


@pytest.mark.asyncio
async def test_collection_read_has_health_count_fields(
    test_client: AsyncClient, auth_headers: dict
) -> None:
    """CollectionRead includes health_green/yellow/red/unknown fields defaulting to 0."""
    coll = await _create_collection(test_client, auth_headers)
    coll_id = coll["id"]

    # Check create response
    assert "health_green" in coll
    assert "health_yellow" in coll
    assert "health_red" in coll
    assert "health_unknown" in coll
    assert coll["health_green"] == 0
    assert coll["health_yellow"] == 0
    assert coll["health_red"] == 0
    assert coll["health_unknown"] == 0

    # Check get_collection response
    get_resp = await test_client.get(
        f"/api/v1/collections/{coll_id}", headers=auth_headers
    )
    assert get_resp.status_code == 200
    data = get_resp.json()
    assert "health_green" in data
    assert "health_yellow" in data
    assert "health_red" in data
    assert "health_unknown" in data


@pytest.mark.asyncio
async def test_list_collections_has_health_count_fields(
    test_client: AsyncClient, auth_headers: dict
) -> None:
    """list_collections items include health count fields."""
    await _create_collection(test_client, auth_headers, name="LC Health Coll")

    resp = await test_client.get("/api/v1/collections", headers=auth_headers)
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert len(items) >= 1
    for item in items:
        assert "health_green" in item
        assert "health_yellow" in item
        assert "health_red" in item
        assert "health_unknown" in item


@pytest.mark.asyncio
async def test_health_counts_reflect_repo_statuses(
    test_client: AsyncClient,
    auth_headers: dict,
    db_session: AsyncSession,
    test_user,
) -> None:
    """health_green/yellow/red/unknown counts correctly reflect repo health_status values."""
    coll = await _create_collection(test_client, auth_headers, name="Status Coll")
    coll_id = uuid.UUID(coll["id"])

    # Insert repos directly with known health statuses
    repos = [
        Repo(collection_id=coll_id, github_url="https://github.com/a/r1", name="r1", health_status="green"),
        Repo(collection_id=coll_id, github_url="https://github.com/a/r2", name="r2", health_status="green"),
        Repo(collection_id=coll_id, github_url="https://github.com/a/r3", name="r3", health_status="yellow"),
        Repo(collection_id=coll_id, github_url="https://github.com/a/r4", name="r4", health_status="red"),
        Repo(collection_id=coll_id, github_url="https://github.com/a/r5", name="r5", health_status="unknown"),
        Repo(collection_id=coll_id, github_url="https://github.com/a/r6", name="r6", health_status="unknown"),
    ]
    db_session.add_all(repos)
    await db_session.flush()

    # Check via get_collection
    get_resp = await test_client.get(
        f"/api/v1/collections/{coll_id}", headers=auth_headers
    )
    assert get_resp.status_code == 200
    data = get_resp.json()
    assert data["health_green"] == 2
    assert data["health_yellow"] == 1
    assert data["health_red"] == 1
    assert data["health_unknown"] == 2

    # Also check via list_collections
    list_resp = await test_client.get("/api/v1/collections", headers=auth_headers)
    assert list_resp.status_code == 200
    items = list_resp.json()["items"]
    target = next(i for i in items if i["id"] == str(coll_id))
    assert target["health_green"] == 2
    assert target["health_yellow"] == 1
    assert target["health_red"] == 1
    assert target["health_unknown"] == 2
