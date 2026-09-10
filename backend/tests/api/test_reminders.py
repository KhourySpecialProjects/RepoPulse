"""Tests for due-reminder firing, the reminders inbox, and comment mentions."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import create_access_token
from app.models.note import Note
from app.models.note_comment import NoteComment
from app.models.notification import Notification, NotificationType
from app.models.user import User


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def sarah(db_session: AsyncSession) -> User:
    user = User(
        id=uuid.uuid4(),
        email="sarah_ta@example.com",
        display_name="Sarah TA",
        role="ta",
        password_hash=None,
    )
    db_session.add(user)
    await db_session.flush()
    return user


@pytest_asyncio.fixture
async def mark(db_session: AsyncSession) -> User:
    user = User(
        id=uuid.uuid4(),
        email="mark_instructor@example.com",
        display_name="Mark",
        role="instructor",
        password_hash=None,
    )
    db_session.add(user)
    await db_session.flush()
    return user


@pytest.fixture
def sarah_headers(sarah: User) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token({'sub': str(sarah.id)})}"}


@pytest.fixture
def mark_headers(mark: User) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token({'sub': str(mark.id)})}"}


async def _add_reminder(
    db_session: AsyncSession,
    author: User,
    content: str,
    remind_at: datetime | None,
    *,
    is_checked: bool = False,
    is_archived: bool = False,
) -> Note:
    note = Note(
        id=uuid.uuid4(),
        author_id=author.id,
        content=content,
        is_reminder=True,
        remind_at=remind_at,
        is_checked=is_checked,
        is_archived=is_archived,
    )
    db_session.add(note)
    await db_session.flush()
    return note


# ---------------------------------------------------------------------------
# remind_at persistence
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_note_persists_remind_at(
    test_client: AsyncClient, mark_headers: dict[str, str]
) -> None:
    due = datetime.now(timezone.utc) + timedelta(days=1)
    resp = await test_client.post(
        "/api/v1/notes",
        headers=mark_headers,
        json={
            "content": "Grade the midterms",
            "is_reminder": True,
            "remind_at": due.isoformat(),
        },
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["is_reminder"] is True
    assert body["remind_at"] is not None


@pytest.mark.asyncio
async def test_update_note_can_set_remind_at(
    test_client: AsyncClient, mark_headers: dict[str, str]
) -> None:
    created = await test_client.post(
        "/api/v1/notes",
        headers=mark_headers,
        json={"content": "Follow up", "is_reminder": True},
    )
    note_id = created.json()["id"]
    assert created.json()["remind_at"] is None

    due = datetime.now(timezone.utc) + timedelta(hours=3)
    resp = await test_client.patch(
        f"/api/v1/notes/{note_id}",
        headers=mark_headers,
        json={"remind_at": due.isoformat()},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["remind_at"] is not None


# ---------------------------------------------------------------------------
# Firing due reminders
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_due_reminder_fires_notification(
    test_client: AsyncClient,
    db_session: AsyncSession,
    mark: User,
    mark_headers: dict[str, str],
) -> None:
    past = datetime.now(timezone.utc) - timedelta(minutes=5)
    note = await _add_reminder(db_session, mark, "Reminder that is due", past)

    resp = await test_client.get("/api/v1/notifications", headers=mark_headers)
    assert resp.status_code == 200, resp.text

    types = [n["type"] for n in resp.json()["items"]]
    assert "reminder" in types

    fired = [n for n in resp.json()["items"] if n["type"] == "reminder"]
    assert fired[0]["note_id"] == str(note.id)
    assert fired[0]["is_read"] is False


@pytest.mark.asyncio
async def test_future_reminder_does_not_fire(
    test_client: AsyncClient,
    db_session: AsyncSession,
    mark: User,
    mark_headers: dict[str, str],
) -> None:
    future = datetime.now(timezone.utc) + timedelta(days=2)
    await _add_reminder(db_session, mark, "Not due yet", future)

    resp = await test_client.get("/api/v1/notifications", headers=mark_headers)
    assert resp.status_code == 200
    assert [n for n in resp.json()["items"] if n["type"] == "reminder"] == []


@pytest.mark.asyncio
async def test_reminder_without_due_date_does_not_fire(
    test_client: AsyncClient,
    db_session: AsyncSession,
    mark: User,
    mark_headers: dict[str, str],
) -> None:
    await _add_reminder(db_session, mark, "No due date", None)

    resp = await test_client.get("/api/v1/notifications", headers=mark_headers)
    assert resp.status_code == 200
    assert [n for n in resp.json()["items"] if n["type"] == "reminder"] == []


@pytest.mark.asyncio
async def test_due_reminder_fires_only_once(
    test_client: AsyncClient,
    db_session: AsyncSession,
    mark: User,
    mark_headers: dict[str, str],
) -> None:
    past = datetime.now(timezone.utc) - timedelta(minutes=5)
    note = await _add_reminder(db_session, mark, "Fire once only", past)

    for _ in range(3):
        resp = await test_client.get("/api/v1/notifications", headers=mark_headers)
        assert resp.status_code == 200

    result = await db_session.execute(
        select(Notification).where(
            Notification.note_id == note.id,
            Notification.type == NotificationType.reminder,
        )
    )
    assert len(result.scalars().all()) == 1


@pytest.mark.asyncio
async def test_checked_and_archived_reminders_do_not_fire(
    test_client: AsyncClient,
    db_session: AsyncSession,
    mark: User,
    mark_headers: dict[str, str],
) -> None:
    past = datetime.now(timezone.utc) - timedelta(minutes=5)
    await _add_reminder(db_session, mark, "Done already", past, is_checked=True)
    await _add_reminder(db_session, mark, "Archived", past, is_archived=True)

    resp = await test_client.get("/api/v1/notifications", headers=mark_headers)
    assert resp.status_code == 200
    assert [n for n in resp.json()["items"] if n["type"] == "reminder"] == []


@pytest.mark.asyncio
async def test_reminder_fires_only_for_its_author(
    test_client: AsyncClient,
    db_session: AsyncSession,
    mark: User,
    sarah_headers: dict[str, str],
) -> None:
    past = datetime.now(timezone.utc) - timedelta(minutes=5)
    await _add_reminder(db_session, mark, "Mark's private reminder", past)

    resp = await test_client.get("/api/v1/notifications", headers=sarah_headers)
    assert resp.status_code == 200
    assert resp.json()["items"] == []


@pytest.mark.asyncio
async def test_due_reminder_counts_toward_unread(
    test_client: AsyncClient,
    db_session: AsyncSession,
    mark: User,
    mark_headers: dict[str, str],
) -> None:
    past = datetime.now(timezone.utc) - timedelta(minutes=5)
    await _add_reminder(db_session, mark, "Due now", past)

    resp = await test_client.get("/api/v1/notifications/unread-count", headers=mark_headers)
    assert resp.status_code == 200
    assert resp.json()["unread_count"] >= 1


# ---------------------------------------------------------------------------
# Reminders inbox: GET /notifications/reminders
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_reminders_inbox_lists_active_reminders(
    test_client: AsyncClient,
    db_session: AsyncSession,
    mark: User,
    mark_headers: dict[str, str],
) -> None:
    due = datetime.now(timezone.utc) + timedelta(hours=2)
    await _add_reminder(db_session, mark, "Active reminder", due)

    resp = await test_client.get("/api/v1/notifications/reminders", headers=mark_headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["total"] == 1
    assert body["items"][0]["content"] == "Active reminder"
    assert body["items"][0]["remind_at"] is not None


@pytest.mark.asyncio
async def test_reminders_inbox_excludes_done_and_plain_notes(
    test_client: AsyncClient,
    db_session: AsyncSession,
    mark: User,
    mark_headers: dict[str, str],
) -> None:
    due = datetime.now(timezone.utc) + timedelta(hours=2)
    await _add_reminder(db_session, mark, "Checked", due, is_checked=True)
    await _add_reminder(db_session, mark, "Archived", due, is_archived=True)
    db_session.add(
        Note(id=uuid.uuid4(), author_id=mark.id, content="Plain note", is_reminder=False)
    )
    await db_session.flush()

    resp = await test_client.get("/api/v1/notifications/reminders", headers=mark_headers)
    assert resp.status_code == 200
    assert resp.json()["total"] == 0


@pytest.mark.asyncio
async def test_reminders_inbox_is_per_user(
    test_client: AsyncClient,
    db_session: AsyncSession,
    mark: User,
    sarah_headers: dict[str, str],
) -> None:
    due = datetime.now(timezone.utc) + timedelta(hours=2)
    await _add_reminder(db_session, mark, "Mark's reminder", due)

    resp = await test_client.get("/api/v1/notifications/reminders", headers=sarah_headers)
    assert resp.status_code == 200
    assert resp.json()["total"] == 0


@pytest.mark.asyncio
async def test_reminders_inbox_sorted_soonest_first(
    test_client: AsyncClient,
    db_session: AsyncSession,
    mark: User,
    mark_headers: dict[str, str],
) -> None:
    now = datetime.now(timezone.utc)
    await _add_reminder(db_session, mark, "Later", now + timedelta(days=3))
    await _add_reminder(db_session, mark, "Sooner", now + timedelta(hours=1))
    await _add_reminder(db_session, mark, "No date", None)

    resp = await test_client.get("/api/v1/notifications/reminders", headers=mark_headers)
    assert resp.status_code == 200
    contents = [i["content"] for i in resp.json()["items"]]
    assert contents[:2] == ["Sooner", "Later"]
    # Undated reminders trail the scheduled ones
    assert contents[-1] == "No date"


# ---------------------------------------------------------------------------
# Mentions inside comments
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_mention_in_comment_notifies_mentioned_user(
    test_client: AsyncClient,
    db_session: AsyncSession,
    sarah: User,
    mark: User,
    sarah_headers: dict[str, str],
    mark_headers: dict[str, str],
) -> None:
    note = Note(id=uuid.uuid4(), author_id=sarah.id, content="Sarah's note")
    db_session.add(note)
    await db_session.flush()

    resp = await test_client.post(
        f"/api/v1/notes/{note.id}/comments",
        headers=sarah_headers,
        json={"content": "Can you look at this @Mark?"},
    )
    assert resp.status_code == 201, resp.text

    got = await test_client.get("/api/v1/notifications", headers=mark_headers)
    assert got.status_code == 200
    mentions = [n for n in got.json()["items"] if n["type"] == "mention"]
    assert len(mentions) == 1
    assert mentions[0]["note_id"] == str(note.id)


@pytest.mark.asyncio
async def test_comment_mention_does_not_notify_self(
    test_client: AsyncClient,
    db_session: AsyncSession,
    sarah: User,
    sarah_headers: dict[str, str],
) -> None:
    note = Note(id=uuid.uuid4(), author_id=sarah.id, content="Sarah's note")
    db_session.add(note)
    await db_session.flush()

    resp = await test_client.post(
        f"/api/v1/notes/{note.id}/comments",
        headers=sarah_headers,
        json={"content": "Noting for myself @Sarah_TA"},
    )
    assert resp.status_code == 201

    got = await test_client.get("/api/v1/notifications", headers=sarah_headers)
    assert got.status_code == 200
    assert [n for n in got.json()["items"] if n["type"] == "mention"] == []


@pytest.mark.asyncio
async def test_comment_mention_links_the_comment(
    test_client: AsyncClient,
    db_session: AsyncSession,
    sarah: User,
    mark: User,
    sarah_headers: dict[str, str],
    mark_headers: dict[str, str],
) -> None:
    note = Note(id=uuid.uuid4(), author_id=sarah.id, content="Sarah's note")
    db_session.add(note)
    await db_session.flush()

    created = await test_client.post(
        f"/api/v1/notes/{note.id}/comments",
        headers=sarah_headers,
        json={"content": "@Mark please review"},
    )
    comment_id = created.json()["id"]

    got = await test_client.get("/api/v1/notifications", headers=mark_headers)
    mentions = [n for n in got.json()["items"] if n["type"] == "mention"]
    assert mentions[0]["comment_id"] == comment_id


# ---------------------------------------------------------------------------
# Mention matching against display names that are not plain words
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def mark_parenthesised(db_session: AsyncSession) -> User:
    """Seeded users look like this: display names carrying punctuation."""
    user = User(
        id=uuid.uuid4(),
        email="mark_paren@example.com",
        display_name="Mark (Instructor)",
        role="instructor",
        password_hash=None,
    )
    db_session.add(user)
    await db_session.flush()
    return user


@pytest.mark.asyncio
async def test_mention_matches_display_name_with_punctuation(
    test_client: AsyncClient,
    db_session: AsyncSession,
    sarah: User,
    mark_parenthesised: User,
    sarah_headers: dict[str, str],
) -> None:
    headers = {
        "Authorization": f"Bearer {create_access_token({'sub': str(mark_parenthesised.id)})}"
    }

    resp = await test_client.post(
        "/api/v1/notes",
        headers=sarah_headers,
        json={"content": "Nice work @Mark_(Instructor)", "is_reminder": False},
    )
    assert resp.status_code == 201, resp.text

    got = await test_client.get("/api/v1/notifications", headers=headers)
    assert [n for n in got.json()["items"] if n["type"] == "mention"] != []


@pytest.mark.asyncio
async def test_mention_does_not_match_a_shorter_name_prefix(
    test_client: AsyncClient,
    db_session: AsyncSession,
    sarah: User,
    mark: User,
    mark_parenthesised: User,
    sarah_headers: dict[str, str],
    mark_headers: dict[str, str],
) -> None:
    """@Mark_(Instructor) must not also notify the user plainly called "Mark"."""
    resp = await test_client.post(
        "/api/v1/notes",
        headers=sarah_headers,
        json={"content": "Ping @Mark_(Instructor) only", "is_reminder": False},
    )
    assert resp.status_code == 201

    got = await test_client.get("/api/v1/notifications", headers=mark_headers)
    assert [n for n in got.json()["items"] if n["type"] == "mention"] == []


@pytest.mark.asyncio
async def test_mention_ignores_trailing_punctuation(
    test_client: AsyncClient,
    db_session: AsyncSession,
    sarah: User,
    mark: User,
    sarah_headers: dict[str, str],
    mark_headers: dict[str, str],
) -> None:
    resp = await test_client.post(
        "/api/v1/notes",
        headers=sarah_headers,
        json={"content": "Please review this, @Mark. Thanks!", "is_reminder": False},
    )
    assert resp.status_code == 201

    got = await test_client.get("/api/v1/notifications", headers=mark_headers)
    assert [n for n in got.json()["items"] if n["type"] == "mention"] != []


@pytest.mark.asyncio
async def test_note_edit_only_notifies_newly_added_mentions(
    test_client: AsyncClient,
    db_session: AsyncSession,
    sarah: User,
    mark: User,
    sarah_headers: dict[str, str],
    mark_headers: dict[str, str],
) -> None:
    created = await test_client.post(
        "/api/v1/notes",
        headers=sarah_headers,
        json={"content": "Hello @Mark", "is_reminder": False},
    )
    note_id = created.json()["id"]

    first = await test_client.get("/api/v1/notifications", headers=mark_headers)
    assert len([n for n in first.json()["items"] if n["type"] == "mention"]) == 1

    # Editing around an existing mention must not notify again
    await test_client.patch(
        f"/api/v1/notes/{note_id}",
        headers=sarah_headers,
        json={"content": "Hello @Mark, please take a look"},
    )

    after = await test_client.get("/api/v1/notifications", headers=mark_headers)
    assert len([n for n in after.json()["items"] if n["type"] == "mention"]) == 1
