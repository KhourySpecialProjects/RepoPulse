"""Reminders shared with other users, and reminders that carry no due date."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import create_access_token
from app.models.user import User


@pytest_asyncio.fixture
async def owner(db_session: AsyncSession) -> User:
    user = User(
        id=uuid.uuid4(),
        email="owner_shared@example.com",
        display_name="Owner Instructor",
        role="instructor",
        password_hash=None,
    )
    db_session.add(user)
    await db_session.flush()
    return user


@pytest_asyncio.fixture
async def ta_one(db_session: AsyncSession) -> User:
    user = User(
        id=uuid.uuid4(),
        email="ta_one_shared@example.com",
        display_name="TA One",
        role="ta",
        password_hash=None,
    )
    db_session.add(user)
    await db_session.flush()
    return user


@pytest_asyncio.fixture
async def ta_two(db_session: AsyncSession) -> User:
    user = User(
        id=uuid.uuid4(),
        email="ta_two_shared@example.com",
        display_name="TA Two",
        role="ta",
        password_hash=None,
    )
    db_session.add(user)
    await db_session.flush()
    return user


def _headers(user: User) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token({'sub': str(user.id)})}"}


async def _create_shared_reminder(
    test_client: AsyncClient,
    owner: User,
    share_with: list[User],
    *,
    content: str = "Grade the finals together",
    remind_at: datetime | None = None,
) -> dict:
    payload: dict = {
        "content": content,
        "is_reminder": True,
        "shared_with": [str(u.id) for u in share_with],
    }
    if remind_at is not None:
        payload["remind_at"] = remind_at.isoformat()
    resp = await test_client.post("/api/v1/notes", headers=_headers(owner), json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


# ---------------------------------------------------------------------------
# Creating a shared reminder
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_shared_reminder_appears_for_every_recipient(
    test_client: AsyncClient, owner: User, ta_one: User, ta_two: User
) -> None:
    created = await _create_shared_reminder(test_client, owner, [ta_one, ta_two])

    for user in (owner, ta_one, ta_two):
        inbox = await test_client.get(
            "/api/v1/notifications/reminders", headers=_headers(user)
        )
        assert inbox.status_code == 200, inbox.text
        ids = [item["id"] for item in inbox.json()["items"]]
        assert created["id"] in ids


@pytest.mark.asyncio
async def test_unshared_reminder_stays_private(
    test_client: AsyncClient, owner: User, ta_one: User
) -> None:
    created = await _create_shared_reminder(test_client, owner, [])

    mine = await test_client.get(
        "/api/v1/notifications/reminders", headers=_headers(owner)
    )
    assert created["id"] in [i["id"] for i in mine.json()["items"]]

    theirs = await test_client.get(
        "/api/v1/notifications/reminders", headers=_headers(ta_one)
    )
    assert created["id"] not in [i["id"] for i in theirs.json()["items"]]


@pytest.mark.asyncio
async def test_reminder_reports_who_it_is_shared_with(
    test_client: AsyncClient, owner: User, ta_one: User, ta_two: User
) -> None:
    created = await _create_shared_reminder(test_client, owner, [ta_one, ta_two])

    inbox = await test_client.get(
        "/api/v1/notifications/reminders", headers=_headers(owner)
    )
    entry = next(i for i in inbox.json()["items"] if i["id"] == created["id"])
    assert sorted(entry["shared_with"]) == ["TA One", "TA Two"]
    assert entry["owner_display_name"] == "Owner Instructor"


@pytest.mark.asyncio
async def test_sharing_with_yourself_is_not_duplicated(
    test_client: AsyncClient, owner: User
) -> None:
    created = await _create_shared_reminder(test_client, owner, [owner])

    inbox = await test_client.get(
        "/api/v1/notifications/reminders", headers=_headers(owner)
    )
    matching = [i for i in inbox.json()["items"] if i["id"] == created["id"]]
    assert len(matching) == 1
    assert matching[0]["shared_with"] == []


@pytest.mark.asyncio
async def test_sharing_an_unknown_user_is_rejected(
    test_client: AsyncClient, owner: User
) -> None:
    resp = await test_client.post(
        "/api/v1/notes",
        headers=_headers(owner),
        json={
            "content": "Shared with a ghost",
            "is_reminder": True,
            "shared_with": [str(uuid.uuid4())],
        },
    )
    assert resp.status_code == 404, resp.text


@pytest.mark.asyncio
async def test_plain_notes_cannot_be_shared(
    test_client: AsyncClient, owner: User, ta_one: User
) -> None:
    """Sharing is a reminder feature; a plain note must not silently share."""
    resp = await test_client.post(
        "/api/v1/notes",
        headers=_headers(owner),
        json={
            "content": "Just a note",
            "is_reminder": False,
            "shared_with": [str(ta_one.id)],
        },
    )
    assert resp.status_code == 400, resp.text


# ---------------------------------------------------------------------------
# Firing a shared reminder
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_due_shared_reminder_fires_for_everyone(
    test_client: AsyncClient, owner: User, ta_one: User, ta_two: User
) -> None:
    past = datetime.now(timezone.utc) - timedelta(minutes=5)
    created = await _create_shared_reminder(
        test_client, owner, [ta_one, ta_two], remind_at=past
    )

    for user in (owner, ta_one, ta_two):
        feed = await test_client.get("/api/v1/notifications", headers=_headers(user))
        fired = [
            n
            for n in feed.json()["items"]
            if n["type"] == "reminder" and n["note_id"] == created["id"]
        ]
        assert len(fired) == 1


@pytest.mark.asyncio
async def test_shared_reminder_fires_once_per_person(
    test_client: AsyncClient, owner: User, ta_one: User
) -> None:
    past = datetime.now(timezone.utc) - timedelta(minutes=5)
    created = await _create_shared_reminder(test_client, owner, [ta_one], remind_at=past)

    for _ in range(3):
        await test_client.get("/api/v1/notifications", headers=_headers(ta_one))

    feed = await test_client.get("/api/v1/notifications", headers=_headers(ta_one))
    fired = [
        n
        for n in feed.json()["items"]
        if n["type"] == "reminder" and n["note_id"] == created["id"]
    ]
    assert len(fired) == 1


@pytest.mark.asyncio
async def test_future_shared_reminder_does_not_fire(
    test_client: AsyncClient, owner: User, ta_one: User
) -> None:
    future = datetime.now(timezone.utc) + timedelta(days=2)
    created = await _create_shared_reminder(
        test_client, owner, [ta_one], remind_at=future
    )

    feed = await test_client.get("/api/v1/notifications", headers=_headers(ta_one))
    assert [n for n in feed.json()["items"] if n["note_id"] == created["id"]] == []


@pytest.mark.asyncio
async def test_recipient_cannot_delete_the_shared_reminder(
    test_client: AsyncClient, owner: User, ta_one: User
) -> None:
    """Recipients see a shared reminder, but only the owner controls it."""
    created = await _create_shared_reminder(test_client, owner, [ta_one])

    resp = await test_client.delete(
        f"/api/v1/notes/{created['id']}", headers=_headers(ta_one)
    )
    assert resp.status_code in (403, 404), resp.text

    inbox = await test_client.get(
        "/api/v1/notifications/reminders", headers=_headers(owner)
    )
    assert created["id"] in [i["id"] for i in inbox.json()["items"]]


@pytest.mark.asyncio
async def test_owner_deleting_hides_it_from_recipients(
    test_client: AsyncClient, owner: User, ta_one: User
) -> None:
    created = await _create_shared_reminder(test_client, owner, [ta_one])

    resp = await test_client.delete(
        f"/api/v1/notes/{created['id']}", headers=_headers(owner)
    )
    assert resp.status_code == 200, resp.text

    inbox = await test_client.get(
        "/api/v1/notifications/reminders", headers=_headers(ta_one)
    )
    assert created["id"] not in [i["id"] for i in inbox.json()["items"]]


# ---------------------------------------------------------------------------
# Reminders without a due date are first-class
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_reminder_can_be_created_without_a_due_date(
    test_client: AsyncClient, owner: User
) -> None:
    resp = await test_client.post(
        "/api/v1/notes",
        headers=_headers(owner),
        json={"content": "Undated reminder", "is_reminder": True},
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["remind_at"] is None

    inbox = await test_client.get(
        "/api/v1/notifications/reminders", headers=_headers(owner)
    )
    entry = next(i for i in inbox.json()["items"] if i["id"] == resp.json()["id"])
    assert entry["remind_at"] is None


@pytest.mark.asyncio
async def test_undated_reminder_can_be_shared(
    test_client: AsyncClient, owner: User, ta_one: User
) -> None:
    created = await _create_shared_reminder(
        test_client, owner, [ta_one], content="Undated shared reminder"
    )
    assert created["remind_at"] is None

    inbox = await test_client.get(
        "/api/v1/notifications/reminders", headers=_headers(ta_one)
    )
    assert created["id"] in [i["id"] for i in inbox.json()["items"]]


@pytest.mark.asyncio
async def test_undated_reminder_can_gain_a_date_later(
    test_client: AsyncClient, owner: User
) -> None:
    created = await test_client.post(
        "/api/v1/notes",
        headers=_headers(owner),
        json={"content": "Date me later", "is_reminder": True},
    )
    note_id = created.json()["id"]

    due = datetime.now(timezone.utc) + timedelta(hours=2)
    updated = await test_client.patch(
        f"/api/v1/notes/{note_id}",
        headers=_headers(owner),
        json={"remind_at": due.isoformat()},
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["remind_at"] is not None
