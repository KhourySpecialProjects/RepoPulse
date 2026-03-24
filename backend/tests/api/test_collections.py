"""Tests for collections CRUD endpoints."""
from __future__ import annotations

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_create_collection(
    test_client: AsyncClient, auth_headers: dict
) -> None:
    response = await test_client.post(
        "/api/v1/collections",
        headers=auth_headers,
        json={
            "name": "Test Collection",
            "course_tag": "CS 101",
            "semester_tag": "Spring 2026",
            "local_folder_name": "cs101-s26",
        },
    )
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "Test Collection"
    assert data["course_tag"] == "CS 101"
    assert data["repo_count"] == 0


@pytest.mark.asyncio
async def test_list_collections_empty(
    test_client: AsyncClient, auth_headers: dict
) -> None:
    response = await test_client.get("/api/v1/collections", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert "items" in data
    assert "total" in data
    assert "limit" in data
    assert "offset" in data


@pytest.mark.asyncio
async def test_get_collection(
    test_client: AsyncClient, auth_headers: dict
) -> None:
    # Create first
    create_resp = await test_client.post(
        "/api/v1/collections",
        headers=auth_headers,
        json={
            "name": "My Collection",
            "local_folder_name": "my-collection",
        },
    )
    assert create_resp.status_code == 201
    collection_id = create_resp.json()["id"]

    # Fetch it
    get_resp = await test_client.get(
        f"/api/v1/collections/{collection_id}", headers=auth_headers
    )
    assert get_resp.status_code == 200
    assert get_resp.json()["id"] == collection_id


@pytest.mark.asyncio
async def test_update_collection(
    test_client: AsyncClient, auth_headers: dict
) -> None:
    create_resp = await test_client.post(
        "/api/v1/collections",
        headers=auth_headers,
        json={"name": "Old Name", "local_folder_name": "old"},
    )
    collection_id = create_resp.json()["id"]

    update_resp = await test_client.patch(
        f"/api/v1/collections/{collection_id}",
        headers=auth_headers,
        json={"name": "New Name"},
    )
    assert update_resp.status_code == 200
    assert update_resp.json()["name"] == "New Name"


@pytest.mark.asyncio
async def test_delete_collection(
    test_client: AsyncClient, auth_headers: dict
) -> None:
    create_resp = await test_client.post(
        "/api/v1/collections",
        headers=auth_headers,
        json={"name": "To Delete", "local_folder_name": "to-delete"},
    )
    collection_id = create_resp.json()["id"]

    del_resp = await test_client.delete(
        f"/api/v1/collections/{collection_id}", headers=auth_headers
    )
    assert del_resp.status_code == 204

    get_resp = await test_client.get(
        f"/api/v1/collections/{collection_id}", headers=auth_headers
    )
    assert get_resp.status_code == 404


@pytest.mark.asyncio
async def test_get_nonexistent_collection(
    test_client: AsyncClient, auth_headers: dict
) -> None:
    import uuid
    response = await test_client.get(
        f"/api/v1/collections/{uuid.uuid4()}", headers=auth_headers
    )
    assert response.status_code == 404
