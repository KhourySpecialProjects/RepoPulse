"""Tests for RBAC changes to notes endpoints and mention notifications."""
from __future__ import annotations

import uuid

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import create_access_token
from app.models.collection import Collection
from app.models.collection_access import CollectionAccess, CollectionRole
from app.models.note import Note
from app.models.repo import Repo
from app.models.user import User


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def instructor(db_session: AsyncSession) -> User:
    user = User(
        id=uuid.uuid4(),
        email="instructor_notes@example.com",
        display_name="Instructor Notes",
        role="instructor",
        password_hash=None,
    )
    db_session.add(user)
    await db_session.flush()
    return user


@pytest.fixture
def instructor_headers(instructor: User) -> dict[str, str]:
    token = create_access_token({"sub": str(instructor.id)})
    return {"Authorization": f"Bearer {token}"}


@pytest_asyncio.fixture
async def ta_notes(db_session: AsyncSession) -> User:
    user = User(
        id=uuid.uuid4(),
        email="ta_notes@example.com",
        display_name="TA Notes",
        role="ta",
        password_hash=None,
    )
    db_session.add(user)
    await db_session.flush()
    return user


@pytest.fixture
def ta_notes_headers(ta_notes: User) -> dict[str, str]:
    token = create_access_token({"sub": str(ta_notes.id)})
    return {"Authorization": f"Bearer {token}"}


@pytest_asyncio.fixture
async def notes_collection(
    db_session: AsyncSession, instructor: User
) -> Collection:
    col = Collection(
        id=uuid.uuid4(),
        name="Notes Collection",
        local_folder_name="notes-col",
        owner_id=instructor.id,
    )
    db_session.add(col)
    await db_session.flush()
    return col


@pytest_asyncio.fixture
async def notes_repo(
    db_session: AsyncSession, notes_collection: Collection
) -> Repo:
    repo = Repo(
        id=uuid.uuid4(),
        collection_id=notes_collection.id,
        github_url="https://github.com/test/notes-repo",
        name="notes-repo",
        local_path="/tmp/notes-repo",
        health_status="unknown",
    )
    db_session.add(repo)
    await db_session.flush()
    return repo


@pytest_asyncio.fixture
async def ta_access_notes(
    db_session: AsyncSession, notes_collection: Collection, ta_notes: User
) -> CollectionAccess:
    access = CollectionAccess(
        collection_id=notes_collection.id,
        user_id=ta_notes.id,
        access_role=CollectionRole.ta,
    )
    db_session.add(access)
    await db_session.flush()
    return access


@pytest_asyncio.fixture
async def instructor_note(
    db_session: AsyncSession, instructor: User, notes_repo: Repo
) -> Note:
    note = Note(
        id=uuid.uuid4(),
        author_id=instructor.id,
        repo_id=notes_repo.id,
        content="Instructor observation",
    )
    db_session.add(note)
    await db_session.flush()
    return note


# ---------------------------------------------------------------------------
# list_notes with repo_id — shows all notes for that repo
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_notes_by_repo_shows_all_authors(
    test_client: AsyncClient,
    db_session: AsyncSession,
    notes_repo: Repo,
    instructor: User,
    instructor_headers: dict,
    ta_notes: User,
    ta_access_notes: CollectionAccess,
    ta_notes_headers: dict,
) -> None:
    """When repo_id is given, all notes for that repo are returned (not just author's)."""
    # TA creates a note
    ta_note = Note(
        author_id=ta_notes.id,
        repo_id=notes_repo.id,
        content="TA observation",
    )
    db_session.add(ta_note)
    # Instructor creates a note
    inst_note = Note(
        author_id=instructor.id,
        repo_id=notes_repo.id,
        content="Instructor observation",
    )
    db_session.add(inst_note)
    await db_session.flush()

    resp = await test_client.get(
        f"/api/v1/notes?repo_id={notes_repo.id}",
        headers=instructor_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    contents = [n["content"] for n in data["items"]]
    assert "TA observation" in contents
    assert "Instructor observation" in contents


@pytest.mark.asyncio
async def test_list_notes_by_repo_no_access_returns_403(
    test_client: AsyncClient,
    notes_repo: Repo,
    db_session: AsyncSession,
) -> None:
    outsider = User(
        id=uuid.uuid4(),
        email="outsider_notes@example.com",
        display_name="Outsider",
        role="instructor",
        password_hash=None,
    )
    db_session.add(outsider)
    await db_session.flush()

    token = create_access_token({"sub": str(outsider.id)})
    headers = {"Authorization": f"Bearer {token}"}

    resp = await test_client.get(
        f"/api/v1/notes?repo_id={notes_repo.id}",
        headers=headers,
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_list_notes_without_repo_returns_own_global_notes(
    test_client: AsyncClient,
    instructor_headers: dict,
    instructor: User,
    db_session: AsyncSession,
    notes_repo: Repo,
) -> None:
    """With no repo_id and no contributor_id, return current user's global notes only."""
    global_note = Note(
        author_id=instructor.id,
        repo_id=None,
        content="My global note",
    )
    db_session.add(global_note)
    await db_session.flush()

    resp = await test_client.get("/api/v1/notes", headers=instructor_headers)
    data = resp.json()
    contents = [n["content"] for n in data["items"]]
    assert "My global note" in contents
    # Repo note should NOT appear in scratchpad listing
    assert "Instructor observation" not in contents


# ---------------------------------------------------------------------------
# update_note — is_checked by any user with access
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_ta_can_check_note(
    test_client: AsyncClient,
    instructor_note: Note,
    ta_access_notes: CollectionAccess,
    ta_notes_headers: dict,
) -> None:
    resp = await test_client.patch(
        f"/api/v1/notes/{instructor_note.id}",
        headers=ta_notes_headers,
        json={"is_checked": True},
    )
    assert resp.status_code == 200
    assert resp.json()["is_checked"] is True


@pytest.mark.asyncio
async def test_ta_cannot_edit_note_content(
    test_client: AsyncClient,
    instructor_note: Note,
    ta_access_notes: CollectionAccess,
    ta_notes_headers: dict,
) -> None:
    resp = await test_client.patch(
        f"/api/v1/notes/{instructor_note.id}",
        headers=ta_notes_headers,
        json={"content": "TA overwriting content"},
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_author_can_edit_content(
    test_client: AsyncClient,
    instructor_note: Note,
    instructor_headers: dict,
) -> None:
    resp = await test_client.patch(
        f"/api/v1/notes/{instructor_note.id}",
        headers=instructor_headers,
        json={"content": "Updated by author"},
    )
    assert resp.status_code == 200
    assert resp.json()["content"] == "Updated by author"


# ---------------------------------------------------------------------------
# delete_note — only author or admin
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_ta_cannot_delete_others_note(
    test_client: AsyncClient,
    instructor_note: Note,
    ta_access_notes: CollectionAccess,
    ta_notes_headers: dict,
) -> None:
    resp = await test_client.delete(
        f"/api/v1/notes/{instructor_note.id}",
        headers=ta_notes_headers,
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_author_can_delete_own_note(
    test_client: AsyncClient,
    instructor_note: Note,
    instructor_headers: dict,
) -> None:
    resp = await test_client.delete(
        f"/api/v1/notes/{instructor_note.id}",
        headers=instructor_headers,
    )
    assert resp.status_code == 200


# ---------------------------------------------------------------------------
# @mention notifications
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_mention_in_note_creates_notification(
    test_client: AsyncClient,
    db_session: AsyncSession,
    instructor: User,
    instructor_headers: dict,
    notes_repo: Repo,
    ta_notes: User,
    ta_access_notes: CollectionAccess,
) -> None:
    """Creating a note with @Display_Name mention creates notification for that user."""
    # ta_notes has display_name "TA Notes"
    slug = "TA_Notes"
    resp = await test_client.post(
        "/api/v1/notes",
        headers=instructor_headers,
        json={
            "content": f"Hey @{slug}, please review this.",
            "repo_id": str(notes_repo.id),
        },
    )
    assert resp.status_code == 201

    # ta_notes should now have a notification
    token = create_access_token({"sub": str(ta_notes.id)})
    ta_notif_resp = await test_client.get(
        "/api/v1/notifications",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert ta_notif_resp.status_code == 200
    data = ta_notif_resp.json()
    mention_notifs = [n for n in data["items"] if n["type"] == "mention"]
    assert len(mention_notifs) >= 1
