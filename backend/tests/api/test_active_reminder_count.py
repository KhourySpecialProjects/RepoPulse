"""Tests for active_reminder_count on repo list endpoint (Feature 1)."""
from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.note import Note


async def _create_collection(client: AsyncClient, headers: dict) -> str:
    resp = await client.post(
        "/api/v1/collections",
        headers=headers,
        json={
            "name": "Reminder Test Coll",
            "local_folder_name": f"reminder-test-{uuid.uuid4().hex[:6]}",
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
async def test_list_repos_returns_active_reminder_count_field(
    test_client: AsyncClient, auth_headers: dict
) -> None:
    """list_repos response includes active_reminder_count field defaulting to 0."""
    coll_id = await _create_collection(test_client, auth_headers)
    await _create_repo(test_client, auth_headers, coll_id)

    resp = await test_client.get(
        f"/api/v1/collections/{coll_id}/repos", headers=auth_headers
    )
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert len(items) == 1
    assert "active_reminder_count" in items[0]
    assert items[0]["active_reminder_count"] == 0


@pytest.mark.asyncio
async def test_list_repos_active_reminder_count_reflects_active_reminders(
    test_client: AsyncClient,
    auth_headers: dict,
    db_session: AsyncSession,
    test_user,
) -> None:
    """active_reminder_count counts only active (non-checked, non-archived) reminders."""
    coll_id = await _create_collection(test_client, auth_headers)
    repo = await _create_repo(test_client, auth_headers, coll_id)
    repo_id = uuid.UUID(repo["id"])

    # Active reminder
    active_reminder = Note(
        author_id=test_user.id,
        repo_id=repo_id,
        content="Follow up on this repo.",
        is_reminder=True,
        is_checked=False,
        is_archived=False,
    )
    # Checked reminder — should NOT be counted
    checked_reminder = Note(
        author_id=test_user.id,
        repo_id=repo_id,
        content="Already checked.",
        is_reminder=True,
        is_checked=True,
        is_archived=False,
    )
    # Archived reminder — should NOT be counted
    archived_reminder = Note(
        author_id=test_user.id,
        repo_id=repo_id,
        content="Archived.",
        is_reminder=True,
        is_checked=False,
        is_archived=True,
    )
    # Plain note (not a reminder) — should NOT be counted
    plain_note = Note(
        author_id=test_user.id,
        repo_id=repo_id,
        content="Just a note.",
        is_reminder=False,
        is_checked=False,
        is_archived=False,
    )
    db_session.add_all([active_reminder, checked_reminder, archived_reminder, plain_note])
    await db_session.flush()

    resp = await test_client.get(
        f"/api/v1/collections/{coll_id}/repos", headers=auth_headers
    )
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert len(items) == 1
    assert items[0]["active_reminder_count"] == 1
