"""Tests for PATCH /repos/{repo_id} endpoint."""
from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient


async def _create_collection(client: AsyncClient, headers: dict) -> str:
    resp = await client.post(
        "/api/v1/collections",
        headers=headers,
        json={
            "name": "Test Coll",
            "course_tag": "CS101",
            "semester_tag": "Spring 2026",
            "local_folder_name": f"cs101-{uuid.uuid4().hex[:6]}",
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
async def test_patch_repo_expected_contributor_count(
    test_client: AsyncClient, auth_headers: dict
) -> None:
    """PATCH sets expected_contributor_count and returns it in the response."""
    coll_id = await _create_collection(test_client, auth_headers)
    repo = await _create_repo(test_client, auth_headers, coll_id)
    repo_id = repo["id"]

    resp = await test_client.patch(
        f"/api/v1/repos/{repo_id}",
        headers=auth_headers,
        json={"expected_contributor_count": 4},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["expected_contributor_count"] == 4
    assert data["id"] == repo_id


@pytest.mark.asyncio
async def test_patch_repo_clear_expected_contributor_count(
    test_client: AsyncClient, auth_headers: dict
) -> None:
    """PATCH with null clears expected_contributor_count."""
    coll_id = await _create_collection(test_client, auth_headers)
    repo = await _create_repo(test_client, auth_headers, coll_id)
    repo_id = repo["id"]

    # Set it first
    await test_client.patch(
        f"/api/v1/repos/{repo_id}",
        headers=auth_headers,
        json={"expected_contributor_count": 4},
    )

    # Clear it
    resp = await test_client.patch(
        f"/api/v1/repos/{repo_id}",
        headers=auth_headers,
        json={"expected_contributor_count": None},
    )
    assert resp.status_code == 200
    assert resp.json()["expected_contributor_count"] is None


@pytest.mark.asyncio
async def test_patch_repo_not_found(
    test_client: AsyncClient, auth_headers: dict
) -> None:
    """PATCH on non-existent repo_id returns 404."""
    resp = await test_client.patch(
        f"/api/v1/repos/{uuid.uuid4()}",
        headers=auth_headers,
        json={"expected_contributor_count": 3},
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_patch_repo_empty_body_is_noop(
    test_client: AsyncClient, auth_headers: dict
) -> None:
    """PATCH with an empty body (no fields) returns the repo unchanged."""
    coll_id = await _create_collection(test_client, auth_headers)
    repo = await _create_repo(test_client, auth_headers, coll_id)
    repo_id = repo["id"]

    resp = await test_client.patch(
        f"/api/v1/repos/{repo_id}",
        headers=auth_headers,
        json={},
    )
    assert resp.status_code == 200
    assert resp.json()["id"] == repo_id
