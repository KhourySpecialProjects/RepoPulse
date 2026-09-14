"""A deleted reminder comes back, and only Recently deleted destroys it.

Removing a reminder from the panel is a soft delete: it leaves the active list,
shows up under Recently deleted, and Restore puts it back where it was. The
only thing that actually destroys it is the permanent delete on that list.

Restoring only clears `deleted_at`, while the active-reminders query also
requires `is_checked` and `is_archived` to be false — so anything that flips
one of those on the way out would leave a reminder that restores in the
database but never reappears in the panel. These tests pin the round trip.
"""
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
from app.models.user import User


@pytest_asyncio.fixture
async def owner(db_session: AsyncSession) -> User:
    user = User(
        id=uuid.uuid4(),
        email="reminder_owner@example.com",
        display_name="Reminder Owner",
        role="instructor",
        password_hash=None,
    )
    db_session.add(user)
    await db_session.flush()
    return user


@pytest.fixture
def headers(owner: User) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token({'sub': str(owner.id)})}"}


@pytest_asyncio.fixture
async def reminder(db_session: AsyncSession, owner: User) -> Note:
    note = Note(
        id=uuid.uuid4(),
        author_id=owner.id,
        content="Grade the final submissions",
        is_reminder=True,
        remind_at=datetime.now(timezone.utc) + timedelta(days=3),
    )
    db_session.add(note)
    await db_session.flush()
    return note


async def _active_ids(client: AsyncClient, headers: dict) -> set[str]:
    resp = await client.get("/api/v1/notifications/reminders", headers=headers)
    assert resp.status_code == 200
    return {item["id"] for item in resp.json()["items"]}


async def _deleted_reminder_ids(client: AsyncClient, headers: dict) -> set[str]:
    resp = await client.get(
        "/api/v1/notifications/recently-deleted", headers=headers
    )
    assert resp.status_code == 200
    return {i["id"] for i in resp.json()["items"] if i["kind"] == "reminder"}


@pytest.mark.asyncio
async def test_a_reminder_starts_out_active(
    test_client: AsyncClient, reminder: Note, headers: dict
) -> None:
    assert str(reminder.id) in await _active_ids(test_client, headers)


@pytest.mark.asyncio
async def test_deleting_moves_it_to_recently_deleted_without_destroying_it(
    test_client: AsyncClient,
    db_session: AsyncSession,
    reminder: Note,
    headers: dict,
) -> None:
    resp = await test_client.delete(
        f"/api/v1/notes/{reminder.id}", headers=headers
    )
    assert resp.status_code == 200

    assert str(reminder.id) not in await _active_ids(test_client, headers)
    assert str(reminder.id) in await _deleted_reminder_ids(test_client, headers)

    # Still in the database — this delete must never be the destructive one.
    row = (
        await db_session.execute(select(Note).where(Note.id == reminder.id))
    ).scalar_one_or_none()
    assert row is not None


@pytest.mark.asyncio
async def test_restoring_puts_it_back_in_the_active_list(
    test_client: AsyncClient, reminder: Note, headers: dict
) -> None:
    """The reported bug: it restored, but never reappeared in the panel."""
    await test_client.delete(f"/api/v1/notes/{reminder.id}", headers=headers)

    resp = await test_client.post(
        f"/api/v1/notes/{reminder.id}/restore", headers=headers
    )
    assert resp.status_code == 200

    assert str(reminder.id) in await _active_ids(test_client, headers)
    assert str(reminder.id) not in await _deleted_reminder_ids(test_client, headers)


@pytest.mark.asyncio
async def test_restoring_clears_every_flag_that_hides_it(
    test_client: AsyncClient,
    db_session: AsyncSession,
    reminder: Note,
    headers: dict,
) -> None:
    """Restore has to undo the whole of 'deleted', not just `deleted_at`.

    The active query filters on three columns. A restore that clears one and
    leaves another set reads as a no-op to the user.
    """
    await test_client.delete(f"/api/v1/notes/{reminder.id}", headers=headers)
    await test_client.post(f"/api/v1/notes/{reminder.id}/restore", headers=headers)

    await db_session.refresh(reminder)
    assert reminder.deleted_at is None
    assert reminder.is_checked is False
    assert reminder.is_archived is False


@pytest.mark.asyncio
async def test_only_the_permanent_delete_destroys_it(
    test_client: AsyncClient,
    db_session: AsyncSession,
    reminder: Note,
    headers: dict,
) -> None:
    await test_client.delete(f"/api/v1/notes/{reminder.id}", headers=headers)

    resp = await test_client.delete(
        f"/api/v1/notes/{reminder.id}/permanent", headers=headers
    )
    assert resp.status_code == 204

    assert str(reminder.id) not in await _deleted_reminder_ids(test_client, headers)
    row = (
        await db_session.execute(select(Note).where(Note.id == reminder.id))
    ).scalar_one_or_none()
    assert row is None
