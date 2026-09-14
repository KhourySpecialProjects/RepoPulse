"""Clearing a notification must never take the conversation with it.

A mention notification is a pointer, not the message. The note it points at is
usually one turn in a thread — often with replies hanging off it — and the
person clearing their inbox is not asking to delete any of that. Losing a note
this way would destroy discussion no one intended to touch, and the note's
author may not even be the person who dismissed the notification.

Both the soft dismiss and the permanent purge are covered: the destructive one
is the one that would actually lose data if it ever started cascading.
"""
from __future__ import annotations

import uuid

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

NOTE_BODY = "@Reader this is the part of the thread that must survive"


@pytest_asyncio.fixture
async def author(db_session: AsyncSession) -> User:
    user = User(
        id=uuid.uuid4(),
        email="thread_author@example.com",
        display_name="Thread Author",
        role="instructor",
        password_hash=None,
    )
    db_session.add(user)
    await db_session.flush()
    return user


@pytest_asyncio.fixture
async def reader(db_session: AsyncSession) -> User:
    """The mentioned user — the one who clears the notification."""
    user = User(
        id=uuid.uuid4(),
        email="thread_reader@example.com",
        display_name="Reader",
        role="ta",
        password_hash=None,
    )
    db_session.add(user)
    await db_session.flush()
    return user


@pytest.fixture
def reader_headers(reader: User) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token({'sub': str(reader.id)})}"}


@pytest_asyncio.fixture
async def mention(
    db_session: AsyncSession, author: User, reader: User
) -> tuple[Notification, Note, NoteComment]:
    note = Note(id=uuid.uuid4(), author_id=author.id, content=NOTE_BODY)
    db_session.add(note)
    await db_session.flush()

    reply = NoteComment(
        id=uuid.uuid4(),
        note_id=note.id,
        author_id=author.id,
        content="and here is the follow-up reply",
    )
    db_session.add(reply)
    await db_session.flush()

    notif = Notification(
        id=uuid.uuid4(),
        recipient_id=reader.id,
        type=NotificationType.mention,
        note_id=note.id,
        is_read=False,
    )
    db_session.add(notif)
    await db_session.flush()
    return notif, note, reply


async def _note_still_there(db: AsyncSession, note_id: uuid.UUID) -> Note | None:
    return (
        await db.execute(select(Note).where(Note.id == note_id))
    ).scalar_one_or_none()


@pytest.mark.asyncio
async def test_dismissing_a_mention_leaves_the_note_intact(
    test_client: AsyncClient,
    db_session: AsyncSession,
    mention: tuple[Notification, Note, NoteComment],
    reader_headers: dict,
) -> None:
    notif, note, _reply = mention

    resp = await test_client.delete(
        f"/api/v1/notifications/{notif.id}", headers=reader_headers
    )
    assert resp.status_code == 204

    survivor = await _note_still_there(db_session, note.id)
    assert survivor is not None
    assert survivor.content == NOTE_BODY
    # Not soft-deleted either — it must still show in the repo's notes.
    assert survivor.deleted_at is None


@pytest.mark.asyncio
async def test_purging_a_mention_leaves_the_note_and_its_replies(
    test_client: AsyncClient,
    db_session: AsyncSession,
    mention: tuple[Notification, Note, NoteComment],
    reader_headers: dict,
) -> None:
    """The permanent delete is the one that could actually cascade."""
    notif, note, reply = mention

    await test_client.delete(
        f"/api/v1/notifications/{notif.id}", headers=reader_headers
    )
    resp = await test_client.delete(
        f"/api/v1/notifications/{notif.id}/permanent", headers=reader_headers
    )
    assert resp.status_code == 204

    survivor = await _note_still_there(db_session, note.id)
    assert survivor is not None
    assert survivor.content == NOTE_BODY

    surviving_reply = (
        await db_session.execute(
            select(NoteComment).where(NoteComment.id == reply.id)
        )
    ).scalar_one_or_none()
    assert surviving_reply is not None


@pytest.mark.asyncio
async def test_the_notification_itself_does_go_away(
    test_client: AsyncClient,
    mention: tuple[Notification, Note, NoteComment],
    reader_headers: dict,
) -> None:
    """Guard against the test above passing because nothing happened at all."""
    notif, _note, _reply = mention

    listing = await test_client.get("/api/v1/notifications", headers=reader_headers)
    assert any(i["id"] == str(notif.id) for i in listing.json()["items"])

    await test_client.delete(
        f"/api/v1/notifications/{notif.id}", headers=reader_headers
    )

    after = await test_client.get("/api/v1/notifications", headers=reader_headers)
    assert not any(i["id"] == str(notif.id) for i in after.json()["items"])
