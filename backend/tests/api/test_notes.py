"""Tests for notes CRUD endpoints."""
from __future__ import annotations

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_create_note(test_client: AsyncClient, auth_headers: dict) -> None:
    response = await test_client.post(
        "/api/v1/notes",
        headers=auth_headers,
        json={"content": "This is a test note.", "is_reminder": False},
    )
    assert response.status_code == 201
    data = response.json()
    assert data["content"] == "This is a test note."
    assert data["is_reminder"] is False
    assert data["repo_id"] is None


@pytest.mark.asyncio
async def test_create_reminder(test_client: AsyncClient, auth_headers: dict) -> None:
    response = await test_client.post(
        "/api/v1/notes",
        headers=auth_headers,
        json={
            "content": "Follow up on project progress.",
            "is_reminder": True,
            "reminder_context": "Check next week.",
        },
    )
    assert response.status_code == 201
    data = response.json()
    assert data["is_reminder"] is True
    assert data["reminder_context"] == "Check next week."


@pytest.mark.asyncio
async def test_list_notes(test_client: AsyncClient, auth_headers: dict) -> None:
    # Create a note first
    await test_client.post(
        "/api/v1/notes",
        headers=auth_headers,
        json={"content": "Note 1"},
    )

    response = await test_client.get("/api/v1/notes", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert "items" in data
    assert data["total"] >= 1


@pytest.mark.asyncio
async def test_update_note(test_client: AsyncClient, auth_headers: dict) -> None:
    create_resp = await test_client.post(
        "/api/v1/notes",
        headers=auth_headers,
        json={"content": "Original content"},
    )
    note_id = create_resp.json()["id"]

    update_resp = await test_client.patch(
        f"/api/v1/notes/{note_id}",
        headers=auth_headers,
        json={"content": "Updated content"},
    )
    assert update_resp.status_code == 200
    assert update_resp.json()["content"] == "Updated content"


@pytest.mark.asyncio
async def test_delete_note(test_client: AsyncClient, auth_headers: dict) -> None:
    create_resp = await test_client.post(
        "/api/v1/notes",
        headers=auth_headers,
        json={"content": "To be deleted"},
    )
    note_id = create_resp.json()["id"]

    del_resp = await test_client.delete(
        f"/api/v1/notes/{note_id}", headers=auth_headers
    )
    assert del_resp.status_code == 200
    assert del_resp.json()["detail"] == "Note deleted"


@pytest.mark.asyncio
async def test_create_note_with_commit_hash(
    test_client: AsyncClient, auth_headers: dict
) -> None:
    response = await test_client.post(
        "/api/v1/notes",
        headers=auth_headers,
        json={
            "content": "Bug introduced in this commit.",
            "commit_hash": "a" * 40,
        },
    )
    assert response.status_code == 201
    data = response.json()
    assert data["commit_hash"] == "a" * 40


@pytest.mark.asyncio
async def test_create_note_without_commit_hash_defaults_to_none(
    test_client: AsyncClient, auth_headers: dict
) -> None:
    response = await test_client.post(
        "/api/v1/notes",
        headers=auth_headers,
        json={"content": "No commit attached."},
    )
    assert response.status_code == 201
    assert response.json()["commit_hash"] is None


@pytest.mark.asyncio
async def test_list_notes_filter_by_commit_hash(
    test_client: AsyncClient, auth_headers: dict
) -> None:
    hash_a = "a" * 40
    hash_b = "b" * 40

    await test_client.post(
        "/api/v1/notes",
        headers=auth_headers,
        json={"content": "Note on commit A", "commit_hash": hash_a},
    )
    await test_client.post(
        "/api/v1/notes",
        headers=auth_headers,
        json={"content": "Note on commit B", "commit_hash": hash_b},
    )
    await test_client.post(
        "/api/v1/notes",
        headers=auth_headers,
        json={"content": "No commit note"},
    )

    response = await test_client.get(
        f"/api/v1/notes?commit_hash={hash_a}", headers=auth_headers
    )
    assert response.status_code == 200
    data = response.json()
    assert data["total"] == 1
    assert data["items"][0]["commit_hash"] == hash_a
    assert data["items"][0]["content"] == "Note on commit A"
