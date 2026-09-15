"""Muting an event stops the notification being created at all.

The subscription is checked before the row is written, so a muted event leaves
nothing behind — no feed entry, no unread count, nothing in Recently deleted.
That is the whole point: the alternative, writing rows and hiding them, would
keep growing a table of things the user said they did not want.

Because the check is per user, the same event can be news for one recipient and
silence for another. `test_two_recipients_can_disagree_about_one_event` is the
case that matters: a professor and a TA on the same collection.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest_asyncio
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.collection import Collection
from app.models.collection_access import CollectionAccess, CollectionRole
from app.models.note import Note
from app.models.notification import Notification, NotificationType
from app.models.notification_preference import NotificationPreference
from app.models.repo import Repo
from app.models.user import User
from app.services.notification_service import (
    create_mention_notifications,
    fire_due_reminders,
    notify,
    notify_repo_event,
)


async def _mute(db: AsyncSession, user: User, **events: bool) -> None:
    db.add(
        NotificationPreference(user_id=user.id, subscribed_events=dict(events))
    )
    await db.flush()


async def _count(db: AsyncSession, user: User, type: NotificationType) -> int:
    result = await db.execute(
        select(func.count())
        .select_from(Notification)
        .where(
            Notification.recipient_id == user.id,
            Notification.type == type,
        )
    )
    return result.scalar_one()


@pytest_asyncio.fixture
async def professor(db_session: AsyncSession) -> User:
    user = User(
        id=uuid.uuid4(),
        email="prof@example.edu",
        display_name="Prof Owner",
        role="instructor",
        password_hash=None,
    )
    db_session.add(user)
    await db_session.flush()
    return user


@pytest_asyncio.fixture
async def ta(db_session: AsyncSession) -> User:
    user = User(
        id=uuid.uuid4(),
        email="ta@example.edu",
        display_name="Dana TA",
        role="ta",
        password_hash=None,
    )
    db_session.add(user)
    await db_session.flush()
    return user


@pytest_asyncio.fixture
async def repo(db_session: AsyncSession, professor: User, ta: User) -> Repo:
    """A repo in a collection the professor owns and the TA can reach."""
    collection = Collection(
        id=uuid.uuid4(),
        name="CS 3200",
        local_folder_name="cs3200",
        owner_id=professor.id,
    )
    db_session.add(collection)
    await db_session.flush()

    db_session.add(
        CollectionAccess(
            id=uuid.uuid4(),
            collection_id=collection.id,
            user_id=ta.id,
            access_role=CollectionRole.ta,
        )
    )
    row = Repo(
        id=uuid.uuid4(),
        collection_id=collection.id,
        github_url="https://github.com/example/team-4",
        name="team-4",
        local_path="/repos/cs3200/team-4",
        health_status="green",
    )
    db_session.add(row)
    await db_session.flush()
    return row


# ---------------------------------------------------------------------------
# The default: nothing configured means everything arrives
# ---------------------------------------------------------------------------


async def test_a_user_with_no_preferences_row_gets_everything(
    db_session: AsyncSession, professor: User
) -> None:
    await notify(
        db_session,
        recipient_id=professor.id,
        type=NotificationType.pr_opened,
        subject="team-4 #7 opened",
    )
    await db_session.flush()

    assert await _count(db_session, professor, NotificationType.pr_opened) == 1


async def test_an_event_missing_from_a_saved_map_still_arrives(
    db_session: AsyncSession, professor: User
) -> None:
    """A type added after the user last saved must not silently go dark."""
    await _mute(db_session, professor, mention=False)

    await notify(
        db_session,
        recipient_id=professor.id,
        type=NotificationType.pr_merged,
        subject="team-4 #7 merged",
    )
    await db_session.flush()

    assert await _count(db_session, professor, NotificationType.pr_merged) == 1


# ---------------------------------------------------------------------------
# Muting suppresses creation, per notification kind
# ---------------------------------------------------------------------------


async def test_muting_suppresses_a_repo_event(
    db_session: AsyncSession, professor: User
) -> None:
    await _mute(db_session, professor, pr_opened=False)

    await notify(
        db_session,
        recipient_id=professor.id,
        type=NotificationType.pr_opened,
        subject="team-4 #7 opened",
    )
    await db_session.flush()

    assert await _count(db_session, professor, NotificationType.pr_opened) == 0


async def test_notify_reports_that_it_created_nothing(
    db_session: AsyncSession, professor: User
) -> None:
    """Callers get None rather than a row that was never added."""
    await _mute(db_session, professor, pr_opened=False)

    created = await notify(
        db_session,
        recipient_id=professor.id,
        type=NotificationType.pr_opened,
        subject="team-4 #7 opened",
    )

    assert created is None


async def test_muting_mentions_suppresses_them(
    db_session: AsyncSession, professor: User
) -> None:
    note = Note(
        id=uuid.uuid4(),
        author_id=professor.id,
        content="seed",
        is_reminder=False,
    )
    db_session.add(note)
    await _mute(db_session, professor, mention=False)

    created = await create_mention_notifications(
        db_session, "ping @Prof_Owner about this", note.id
    )
    await db_session.flush()

    assert created == []
    assert await _count(db_session, professor, NotificationType.mention) == 0


async def test_muting_reminders_stops_them_firing(
    db_session: AsyncSession, professor: User
) -> None:
    db_session.add(
        Note(
            id=uuid.uuid4(),
            author_id=professor.id,
            content="Grade team-4",
            is_reminder=True,
            remind_at=datetime.now(timezone.utc) - timedelta(hours=1),
        )
    )
    await _mute(db_session, professor, reminder=False)

    fired = await fire_due_reminders(db_session, professor.id)

    assert fired == 0
    assert await _count(db_session, professor, NotificationType.reminder) == 0


async def test_an_unmuted_reminder_still_fires(
    db_session: AsyncSession, professor: User
) -> None:
    """The mute path must not be the only path that works."""
    db_session.add(
        Note(
            id=uuid.uuid4(),
            author_id=professor.id,
            content="Grade team-4",
            is_reminder=True,
            remind_at=datetime.now(timezone.utc) - timedelta(hours=1),
        )
    )
    await _mute(db_session, professor, pr_opened=False)

    assert await fire_due_reminders(db_session, professor.id) == 1


# ---------------------------------------------------------------------------
# Per-user separation
# ---------------------------------------------------------------------------


async def test_two_recipients_can_disagree_about_one_event(
    db_session: AsyncSession, professor: User, ta: User, repo: Repo
) -> None:
    """The TA mutes repo_added; the professor on the same collection still gets it."""
    await _mute(db_session, ta, repo_added=False)

    created = await notify_repo_event(
        db_session,
        repo=repo,
        type=NotificationType.repo_added,
        subject="team-4 was added to CS 3200",
        body="Prof Owner added team-4.",
    )
    await db_session.flush()

    assert {row.recipient_id for row in created} == {professor.id}
    assert await _count(db_session, professor, NotificationType.repo_added) == 1
    assert await _count(db_session, ta, NotificationType.repo_added) == 0


async def test_muting_one_event_does_not_mute_another_for_the_same_user(
    db_session: AsyncSession, ta: User, repo: Repo
) -> None:
    await _mute(db_session, ta, repo_added=False)

    await notify_repo_event(
        db_session,
        repo=repo,
        type=NotificationType.repo_health_declined,
        subject="team-4 health dropped to red",
        body="team-4 is now scoring red.",
    )
    await db_session.flush()

    assert await _count(db_session, ta, NotificationType.repo_health_declined) == 1
