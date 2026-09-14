"""Email dispatch gating, and who a repo-scoped event reaches.

The email transport is always a recording fake here — `get_email_service` is
patched at its use site in the notification service, so no test builds a real
adapter or opens a socket.
"""
from __future__ import annotations

import uuid
from typing import Any

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.collection import Collection
from app.models.collection_access import CollectionAccess, CollectionRole
from app.models.notification import Notification, NotificationType
from app.models.notification_setting import NotificationSetting
from app.models.repo import Repo
from app.models.user import User
from app.services.email.base import EmailDeliveryError, OutboundEmail
from app.services.notification_service import (
    deliver_emails,
    notify,
    recipients_for_repo,
)


class RecordingEmailService:
    """Captures sends instead of performing them."""

    def __init__(self, fail_with: Exception | None = None) -> None:
        self.sent: list[OutboundEmail] = []
        self._fail_with = fail_with

    async def send(self, message: OutboundEmail) -> None:
        if self._fail_with is not None:
            raise self._fail_with
        self.sent.append(message)


@pytest.fixture
def recorder(monkeypatch: pytest.MonkeyPatch) -> RecordingEmailService:
    service = RecordingEmailService()
    monkeypatch.setattr(
        "app.services.notification_service.get_email_service",
        lambda *args, **kwargs: service,
    )
    return service


@pytest_asyncio.fixture
async def recipient(db_session: AsyncSession) -> User:
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


async def _configured_relay(
    db_session: AsyncSession, user: User, **overrides: Any
) -> NotificationSetting:
    """A relay with enough configuration to attempt a send."""
    defaults: dict[str, Any] = {
        "user_id": user.id,
        "email_enabled": True,
        "transport": "smtp",
        "from_email": "repopulse@example.edu",
        "from_name": "RepoPulse",
        "smtp_host": "smtp.example.edu",
        "smtp_port": 587,
        "smtp_encryption": "starttls",
    }
    defaults.update(overrides)
    setting = NotificationSetting(**defaults)
    db_session.add(setting)
    await db_session.flush()
    return setting


async def _notify_mention(db_session: AsyncSession, user: User) -> Notification:
    notification = await notify(
        db_session,
        recipient_id=user.id,
        type=NotificationType.mention,
        subject="You were mentioned",
        body="Spiros mentioned you on team-4.",
    )
    await db_session.flush()
    assert notification is not None
    return notification


# ---------------------------------------------------------------------------
# Gating
# ---------------------------------------------------------------------------


async def test_notification_is_created_even_with_no_settings_row(
    db_session: AsyncSession, recipient: User, recorder: RecordingEmailService
) -> None:
    """In-app notifications must never depend on email being configured."""
    notification = await _notify_mention(db_session, recipient)
    await deliver_emails(db_session, [notification])

    assert await db_session.get(Notification, notification.id) is not None
    assert recorder.sent == []
    assert notification.emailed_at is None


async def test_no_email_while_the_relay_is_disabled(
    db_session: AsyncSession, recipient: User, recorder: RecordingEmailService
) -> None:
    await _configured_relay(db_session, recipient, email_enabled=False)

    notification = await _notify_mention(db_session, recipient)
    await deliver_emails(db_session, [notification])

    assert recorder.sent == []
    assert notification.emailed_at is None


async def test_no_email_when_the_event_is_unsubscribed(
    db_session: AsyncSession, recipient: User, recorder: RecordingEmailService
) -> None:
    await _configured_relay(
        db_session, recipient, subscribed_events={"mention": False, "reminder": True}
    )

    notification = await _notify_mention(db_session, recipient)
    await deliver_emails(db_session, [notification])

    assert recorder.sent == []


async def test_email_sent_when_subscribed(
    db_session: AsyncSession, recipient: User, recorder: RecordingEmailService
) -> None:
    await _configured_relay(db_session, recipient)

    notification = await _notify_mention(db_session, recipient)
    await deliver_emails(db_session, [notification])

    assert len(recorder.sent) == 1
    message = recorder.sent[0]
    assert message.to == "ta@example.edu"
    assert "mentioned" in message.subject.lower()
    assert "team-4" in message.text
    assert notification.emailed_at is not None


async def test_an_event_missing_from_a_saved_map_still_emails(
    db_session: AsyncSession, recipient: User, recorder: RecordingEmailService
) -> None:
    """A notification type added after the user last saved must not go silent."""
    await _configured_relay(db_session, recipient, subscribed_events={"reminder": True})

    notification = await _notify_mention(db_session, recipient)
    await deliver_emails(db_session, [notification])

    assert len(recorder.sent) == 1


async def test_no_email_when_the_relay_is_incompletely_configured(
    db_session: AsyncSession, recipient: User, recorder: RecordingEmailService
) -> None:
    """Enabled but missing a sender address is not deliverable."""
    await _configured_relay(db_session, recipient, from_email=None)

    notification = await _notify_mention(db_session, recipient)
    await deliver_emails(db_session, [notification])

    assert recorder.sent == []
    assert notification.emailed_at is None


async def test_no_email_when_smtp_host_is_missing(
    db_session: AsyncSession, recipient: User, recorder: RecordingEmailService
) -> None:
    await _configured_relay(db_session, recipient, smtp_host=None)

    notification = await _notify_mention(db_session, recipient)
    await deliver_emails(db_session, [notification])

    assert recorder.sent == []


async def test_resend_needs_an_api_key(
    db_session: AsyncSession, recipient: User, recorder: RecordingEmailService
) -> None:
    await _configured_relay(
        db_session, recipient, transport="resend", resend_api_key=None
    )

    notification = await _notify_mention(db_session, recipient)
    await deliver_emails(db_session, [notification])

    assert recorder.sent == []


async def test_delivery_failure_does_not_raise_or_mark_as_emailed(
    db_session: AsyncSession, recipient: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A dead relay must not break the request that raised the notification."""
    failing = RecordingEmailService(
        fail_with=EmailDeliveryError("SMTP delivery failed: connection refused")
    )
    monkeypatch.setattr(
        "app.services.notification_service.get_email_service",
        lambda *args, **kwargs: failing,
    )
    await _configured_relay(db_session, recipient)

    notification = await _notify_mention(db_session, recipient)
    await deliver_emails(db_session, [notification])  # must not raise

    assert notification.emailed_at is None


async def test_an_already_emailed_notification_is_not_sent_twice(
    db_session: AsyncSession, recipient: User, recorder: RecordingEmailService
) -> None:
    await _configured_relay(db_session, recipient)

    notification = await _notify_mention(db_session, recipient)
    await deliver_emails(db_session, [notification])
    await deliver_emails(db_session, [notification])

    assert len(recorder.sent) == 1


# ---------------------------------------------------------------------------
# Repo-scoped recipients
# ---------------------------------------------------------------------------


async def test_recipients_for_repo_covers_owner_access_and_admins(
    db_session: AsyncSession,
) -> None:
    owner = User(id=uuid.uuid4(), email="owner@example.edu", display_name="Owner", role="instructor")
    co = User(id=uuid.uuid4(), email="co@example.edu", display_name="Co Instructor", role="instructor")
    ta = User(id=uuid.uuid4(), email="ta2@example.edu", display_name="Tam TA", role="ta")
    admin = User(id=uuid.uuid4(), email="admin@example.edu", display_name="Admin", role="admin")
    outsider = User(id=uuid.uuid4(), email="nope@example.edu", display_name="Outsider", role="instructor")
    db_session.add_all([owner, co, ta, admin, outsider])
    await db_session.flush()

    collection = Collection(
        id=uuid.uuid4(),
        name="CS 3200",
        local_folder_name="cs3200",
        owner_id=owner.id,
    )
    db_session.add(collection)
    await db_session.flush()

    db_session.add_all(
        [
            CollectionAccess(
                id=uuid.uuid4(),
                collection_id=collection.id,
                user_id=co.id,
                access_role=CollectionRole.co_instructor,
            ),
            CollectionAccess(
                id=uuid.uuid4(),
                collection_id=collection.id,
                user_id=ta.id,
                access_role=CollectionRole.ta,
            ),
        ]
    )
    repo = Repo(
        id=uuid.uuid4(),
        collection_id=collection.id,
        github_url="https://github.com/example/team-4",
        name="team-4",
        local_path="/repos/cs3200/team-4",
        health_status="green",
    )
    db_session.add(repo)
    await db_session.flush()

    recipients = await recipients_for_repo(db_session, repo)
    ids = {user.id for user in recipients}

    assert owner.id in ids
    assert co.id in ids
    assert ta.id in ids
    # Admins can reach every collection, so they are legitimate recipients.
    assert admin.id in ids
    assert outsider.id not in ids


async def test_recipients_for_repo_deduplicates_an_admin_who_also_owns(
    db_session: AsyncSession,
) -> None:
    admin_owner = User(
        id=uuid.uuid4(), email="both@example.edu", display_name="Admin Owner", role="admin"
    )
    db_session.add(admin_owner)
    await db_session.flush()

    collection = Collection(
        id=uuid.uuid4(), name="CS 4500", local_folder_name="cs4500", owner_id=admin_owner.id
    )
    db_session.add(collection)
    await db_session.flush()

    repo = Repo(
        id=uuid.uuid4(),
        collection_id=collection.id,
        github_url="https://github.com/example/solo",
        name="solo",
        local_path="/repos/cs4500/solo",
        health_status="green",
    )
    db_session.add(repo)
    await db_session.flush()

    recipients = await recipients_for_repo(db_session, repo)

    assert [user.id for user in recipients].count(admin_owner.id) == 1
