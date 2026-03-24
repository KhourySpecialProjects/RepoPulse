"""Tests for notifications endpoints."""
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
from app.models.notification import Notification, NotificationType
from app.models.repo import Repo
from app.models.user import User


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def notif_user(db_session: AsyncSession) -> User:
    user = User(
        id=uuid.uuid4(),
        email="notif_user@example.com",
        display_name="Notif User",
        role="instructor",
        password_hash=None,
    )
    db_session.add(user)
    await db_session.flush()
    return user


@pytest.fixture
def notif_auth_headers(notif_user: User) -> dict[str, str]:
    token = create_access_token({"sub": str(notif_user.id)})
    return {"Authorization": f"Bearer {token}"}


@pytest_asyncio.fixture
async def unread_notification(
    db_session: AsyncSession, notif_user: User
) -> Notification:
    note = Note(
        id=uuid.uuid4(),
        author_id=notif_user.id,
        content="A note",
    )
    db_session.add(note)
    await db_session.flush()

    notif = Notification(
        id=uuid.uuid4(),
        recipient_id=notif_user.id,
        type=NotificationType.mention,
        note_id=note.id,
        is_read=False,
    )
    db_session.add(notif)
    await db_session.flush()
    return notif


# ---------------------------------------------------------------------------
# GET /notifications
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_notifications_empty(
    test_client: AsyncClient, notif_auth_headers: dict
) -> None:
    response = await test_client.get("/api/v1/notifications", headers=notif_auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert "items" in data
    assert "total" in data
    assert "unread_count" in data
    assert data["unread_count"] == 0


@pytest.mark.asyncio
async def test_list_notifications_returns_own_only(
    test_client: AsyncClient,
    notif_auth_headers: dict,
    auth_headers: dict,
    unread_notification: Notification,
) -> None:
    """The notif_user has a notification; test_user should see none."""
    # notif_user sees their notification
    notif_resp = await test_client.get(
        "/api/v1/notifications", headers=notif_auth_headers
    )
    assert notif_resp.json()["total"] >= 1

    # test_user sees none
    other_resp = await test_client.get(
        "/api/v1/notifications", headers=auth_headers
    )
    assert other_resp.json()["total"] == 0


@pytest.mark.asyncio
async def test_list_notifications_unread_only(
    test_client: AsyncClient,
    db_session: AsyncSession,
    notif_user: User,
    notif_auth_headers: dict,
) -> None:
    note = Note(id=uuid.uuid4(), author_id=notif_user.id, content="A note")
    db_session.add(note)
    await db_session.flush()

    unread = Notification(
        recipient_id=notif_user.id,
        type=NotificationType.mention,
        note_id=note.id,
        is_read=False,
    )
    read = Notification(
        recipient_id=notif_user.id,
        type=NotificationType.mention,
        note_id=note.id,
        is_read=True,
    )
    db_session.add(unread)
    db_session.add(read)
    await db_session.flush()

    response = await test_client.get(
        "/api/v1/notifications?unread_only=true", headers=notif_auth_headers
    )
    data = response.json()
    assert all(not n["is_read"] for n in data["items"])
    assert data["unread_count"] >= 1


@pytest.mark.asyncio
async def test_list_notifications_includes_note_preview(
    test_client: AsyncClient,
    notif_auth_headers: dict,
    unread_notification: Notification,
) -> None:
    response = await test_client.get("/api/v1/notifications", headers=notif_auth_headers)
    data = response.json()
    assert len(data["items"]) >= 1
    item = data["items"][0]
    # note_content_preview should be set (note content is "A note")
    assert item["note_content_preview"] == "A note"


# ---------------------------------------------------------------------------
# GET /notifications/unread-count
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_unread_count_endpoint(
    test_client: AsyncClient,
    notif_auth_headers: dict,
    unread_notification: Notification,
) -> None:
    response = await test_client.get(
        "/api/v1/notifications/unread-count", headers=notif_auth_headers
    )
    assert response.status_code == 200
    data = response.json()
    assert "unread_count" in data
    assert data["unread_count"] >= 1


# ---------------------------------------------------------------------------
# PATCH /notifications/{id}/read
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_mark_notification_read(
    test_client: AsyncClient,
    notif_auth_headers: dict,
    unread_notification: Notification,
) -> None:
    response = await test_client.patch(
        f"/api/v1/notifications/{unread_notification.id}/read",
        headers=notif_auth_headers,
    )
    assert response.status_code == 200
    data = response.json()
    assert data["is_read"] is True


@pytest.mark.asyncio
async def test_mark_notification_read_wrong_user(
    test_client: AsyncClient,
    auth_headers: dict,
    unread_notification: Notification,
) -> None:
    """test_user cannot mark notif_user's notification as read."""
    response = await test_client.patch(
        f"/api/v1/notifications/{unread_notification.id}/read",
        headers=auth_headers,
    )
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_mark_nonexistent_notification_read(
    test_client: AsyncClient, notif_auth_headers: dict
) -> None:
    response = await test_client.patch(
        f"/api/v1/notifications/{uuid.uuid4()}/read",
        headers=notif_auth_headers,
    )
    assert response.status_code == 404


# ---------------------------------------------------------------------------
# POST /notifications/mark-all-read
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_mark_all_read(
    test_client: AsyncClient,
    db_session: AsyncSession,
    notif_user: User,
    notif_auth_headers: dict,
) -> None:
    note = Note(id=uuid.uuid4(), author_id=notif_user.id, content="N")
    db_session.add(note)
    await db_session.flush()

    for _ in range(3):
        db_session.add(Notification(
            recipient_id=notif_user.id,
            type=NotificationType.mention,
            note_id=note.id,
            is_read=False,
        ))
    await db_session.flush()

    response = await test_client.post(
        "/api/v1/notifications/mark-all-read", headers=notif_auth_headers
    )
    assert response.status_code == 200
    data = response.json()
    assert data["marked_read"] >= 3

    # Verify unread count is now 0
    count_resp = await test_client.get(
        "/api/v1/notifications/unread-count", headers=notif_auth_headers
    )
    assert count_resp.json()["unread_count"] == 0
