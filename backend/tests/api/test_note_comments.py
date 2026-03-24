"""Tests for note comments endpoints."""
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
from app.models.note_comment import NoteComment
from app.models.repo import Repo
from app.models.user import User


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def second_user(db_session: AsyncSession) -> User:
    user = User(
        id=uuid.uuid4(),
        email="second@example.com",
        display_name="Second User",
        role="instructor",
        password_hash=None,
    )
    db_session.add(user)
    await db_session.flush()
    return user


@pytest.fixture
def second_auth_headers(second_user: User) -> dict[str, str]:
    token = create_access_token({"sub": str(second_user.id)})
    return {"Authorization": f"Bearer {token}"}


@pytest_asyncio.fixture
async def collection_with_repo(
    db_session: AsyncSession, test_user: User
) -> tuple[Collection, Repo]:
    col = Collection(
        id=uuid.uuid4(),
        name="Test Collection",
        local_folder_name="test-col",
        owner_id=test_user.id,
    )
    db_session.add(col)
    await db_session.flush()

    repo = Repo(
        id=uuid.uuid4(),
        collection_id=col.id,
        github_url="https://github.com/test/repo",
        name="test-repo",
        local_path="/tmp/test-repo",
        health_status="unknown",
    )
    db_session.add(repo)
    await db_session.flush()
    return col, repo


@pytest_asyncio.fixture
async def note_with_repo(
    db_session: AsyncSession, test_user: User, collection_with_repo
) -> Note:
    _, repo = collection_with_repo
    note = Note(
        id=uuid.uuid4(),
        author_id=test_user.id,
        repo_id=repo.id,
        content="Test note content",
    )
    db_session.add(note)
    await db_session.flush()
    return note


@pytest_asyncio.fixture
async def global_note(db_session: AsyncSession, test_user: User) -> Note:
    note = Note(
        id=uuid.uuid4(),
        author_id=test_user.id,
        repo_id=None,
        content="Global note",
    )
    db_session.add(note)
    await db_session.flush()
    return note


# ---------------------------------------------------------------------------
# POST /notes/{note_id}/comments
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_comment_on_repo_note(
    test_client: AsyncClient, auth_headers: dict, note_with_repo: Note
) -> None:
    response = await test_client.post(
        f"/api/v1/notes/{note_with_repo.id}/comments",
        headers=auth_headers,
        json={"content": "Great note"},
    )
    assert response.status_code == 201
    data = response.json()
    assert data["content"] == "Great note"
    assert data["note_id"] == str(note_with_repo.id)
    assert "author_id" in data
    assert "created_at" in data


@pytest.mark.asyncio
async def test_create_comment_requires_auth(
    test_client: AsyncClient, note_with_repo: Note
) -> None:
    response = await test_client.post(
        f"/api/v1/notes/{note_with_repo.id}/comments",
        json={"content": "No auth"},
    )
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_create_comment_on_nonexistent_note(
    test_client: AsyncClient, auth_headers: dict
) -> None:
    response = await test_client.post(
        f"/api/v1/notes/{uuid.uuid4()}/comments",
        headers=auth_headers,
        json={"content": "ghost comment"},
    )
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_create_comment_no_access_to_collection(
    test_client: AsyncClient,
    db_session: AsyncSession,
    second_user: User,
    second_auth_headers: dict,
    note_with_repo: Note,
) -> None:
    """A user with no collection access cannot comment on a repo note."""
    response = await test_client.post(
        f"/api/v1/notes/{note_with_repo.id}/comments",
        headers=second_auth_headers,
        json={"content": "Unauthorized comment"},
    )
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_create_comment_on_global_note_by_non_author(
    test_client: AsyncClient,
    second_auth_headers: dict,
    global_note: Note,
) -> None:
    """Non-author cannot comment on a global note."""
    response = await test_client.post(
        f"/api/v1/notes/{global_note.id}/comments",
        headers=second_auth_headers,
        json={"content": "Nope"},
    )
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_create_comment_on_global_note_by_author(
    test_client: AsyncClient,
    auth_headers: dict,
    global_note: Note,
) -> None:
    """Note author can comment on their own global note."""
    response = await test_client.post(
        f"/api/v1/notes/{global_note.id}/comments",
        headers=auth_headers,
        json={"content": "My own comment"},
    )
    assert response.status_code == 201


# ---------------------------------------------------------------------------
# GET /notes/{note_id}/comments
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_comments(
    test_client: AsyncClient, auth_headers: dict, note_with_repo: Note
) -> None:
    # Create two comments
    await test_client.post(
        f"/api/v1/notes/{note_with_repo.id}/comments",
        headers=auth_headers,
        json={"content": "First comment"},
    )
    await test_client.post(
        f"/api/v1/notes/{note_with_repo.id}/comments",
        headers=auth_headers,
        json={"content": "Second comment"},
    )

    response = await test_client.get(
        f"/api/v1/notes/{note_with_repo.id}/comments",
        headers=auth_headers,
    )
    assert response.status_code == 200
    data = response.json()
    assert len(data) >= 2
    # ordered by created_at asc — first comment should appear first
    assert data[0]["content"] == "First comment"
    assert data[1]["content"] == "Second comment"


@pytest.mark.asyncio
async def test_list_comments_no_access(
    test_client: AsyncClient,
    second_auth_headers: dict,
    note_with_repo: Note,
) -> None:
    response = await test_client.get(
        f"/api/v1/notes/{note_with_repo.id}/comments",
        headers=second_auth_headers,
    )
    assert response.status_code == 403


# ---------------------------------------------------------------------------
# DELETE /notes/{note_id}/comments/{comment_id}
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_delete_own_comment(
    test_client: AsyncClient, auth_headers: dict, note_with_repo: Note
) -> None:
    create_resp = await test_client.post(
        f"/api/v1/notes/{note_with_repo.id}/comments",
        headers=auth_headers,
        json={"content": "Delete me"},
    )
    comment_id = create_resp.json()["id"]

    del_resp = await test_client.delete(
        f"/api/v1/notes/{note_with_repo.id}/comments/{comment_id}",
        headers=auth_headers,
    )
    assert del_resp.status_code == 204


@pytest.mark.asyncio
async def test_delete_comment_by_non_author_forbidden(
    test_client: AsyncClient,
    auth_headers: dict,
    second_auth_headers: dict,
    db_session: AsyncSession,
    note_with_repo: Note,
    collection_with_repo,
    second_user: User,
) -> None:
    """Grant second user access to collection, but they still can't delete other's comment."""
    col, _ = collection_with_repo
    access = CollectionAccess(
        collection_id=col.id,
        user_id=second_user.id,
        access_role=CollectionRole.ta,
    )
    db_session.add(access)
    await db_session.flush()

    create_resp = await test_client.post(
        f"/api/v1/notes/{note_with_repo.id}/comments",
        headers=auth_headers,
        json={"content": "Only I can delete this"},
    )
    comment_id = create_resp.json()["id"]

    del_resp = await test_client.delete(
        f"/api/v1/notes/{note_with_repo.id}/comments/{comment_id}",
        headers=second_auth_headers,
    )
    assert del_resp.status_code == 403


@pytest.mark.asyncio
async def test_delete_nonexistent_comment(
    test_client: AsyncClient, auth_headers: dict, note_with_repo: Note
) -> None:
    response = await test_client.delete(
        f"/api/v1/notes/{note_with_repo.id}/comments/{uuid.uuid4()}",
        headers=auth_headers,
    )
    assert response.status_code == 404


# ---------------------------------------------------------------------------
# Notification creation on comment
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_comment_creates_notification_for_note_author(
    test_client: AsyncClient,
    db_session: AsyncSession,
    auth_headers: dict,
    second_auth_headers: dict,
    second_user: User,
    collection_with_repo,
    test_user: User,
) -> None:
    """Commenting on someone else's note creates a notification for the author."""
    col, repo = collection_with_repo
    # Grant second_user access to collection
    access = CollectionAccess(
        collection_id=col.id,
        user_id=second_user.id,
        access_role=CollectionRole.co_instructor,
    )
    db_session.add(access)
    await db_session.flush()

    # Create note owned by test_user
    note = Note(
        author_id=test_user.id,
        repo_id=repo.id,
        content="Important note",
    )
    db_session.add(note)
    await db_session.flush()

    # second_user comments
    await test_client.post(
        f"/api/v1/notes/{note.id}/comments",
        headers=second_auth_headers,
        json={"content": "I saw this note"},
    )

    # test_user checks their notifications
    notif_resp = await test_client.get(
        "/api/v1/notifications",
        headers=auth_headers,
    )
    assert notif_resp.status_code == 200
    data = notif_resp.json()
    assert data["unread_count"] >= 1
    notif_types = [n["type"] for n in data["items"]]
    assert "note_comment" in notif_types
