"""Notification creation: @mention parsing, due reminders, and repo events.

Notification rows are only ever created here. Routes call into this module
rather than inserting rows themselves.

Email is a second delivery channel for the same rows, not a parallel system.
`notify` writes the row; `deliver_emails` sends whichever of those rows the
recipient has subscribed to. The two are separate calls so that mail goes out
*after* the caller commits — emailing about a note whose transaction then
rolled back would announce something that does not exist.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Iterable, Optional, Sequence

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.collection import Collection
from app.models.collection_access import CollectionAccess
from app.models.note import Note
from app.models.notification import Notification, NotificationType
from app.models.notification_setting import NotificationSetting
from app.models.reminder_share import ReminderShare
from app.models.repo import Repo
from app.models.user import User
from app.services.email import EmailDeliveryError, OutboundEmail, get_email_service

logger = logging.getLogger(__name__)

# A mention continues while these characters follow, so "@Mark" is not treated
# as a mention of "Mark" when the text actually reads "@Mark_(Instructor)".
_SLUG_CONTINUATION = frozenset("abcdefghijklmnopqrstuvwxyz0123456789_(")

#: Fallback email subject per type, used when a notification carries no
#: `subject` of its own (the note-scoped types, which have no stored text).
_DEFAULT_SUBJECTS: dict[NotificationType, str] = {
    NotificationType.mention: "You were mentioned on RepoPulse",
    NotificationType.note_comment: "New comment on your note",
    NotificationType.reminder: "A RepoPulse reminder is due",
}


def slug_for_display_name(display_name: str) -> str:
    """The @handle for a display name: spaces become underscores."""
    return display_name.replace(" ", "_")


def content_mentions_slug(content: str, slug: str) -> bool:
    r"""True when ``content`` contains ``@slug`` as a complete mention.

    Matching is done against known slugs rather than by extracting ``@\w+``,
    because display names carry punctuation ("Mark (Instructor)") that a word
    character class stops at, which silently dropped those mentions.
    """
    if not content or not slug:
        return False

    haystack = content.lower()
    needle = "@" + slug.lower()
    start = 0

    while True:
        idx = haystack.find(needle, start)
        if idx == -1:
            return False
        end = idx + len(needle)
        if haystack[end : end + 1] not in _SLUG_CONTINUATION:
            return True
        # A longer slug continues here; keep looking.
        start = end


async def find_mentioned_users(
    db: AsyncSession,
    content: str,
) -> list[User]:
    """Every user @mentioned in ``content``.

    The author is included: tagging yourself is a deliberate note-to-self and
    should land in your own notifications like any other mention.
    """
    if not content:
        return []

    result = await db.execute(select(User))
    return [
        user
        for user in result.scalars().all()
        if content_mentions_slug(content, slug_for_display_name(user.display_name))
    ]


async def create_mention_notifications(
    db: AsyncSession,
    content: str,
    note_id: uuid.UUID,
    *,
    comment_id: Optional[uuid.UUID] = None,
    previous_content: Optional[str] = None,
) -> list[Notification]:
    """Create a mention notification for every user named in ``content``.

    ``comment_id`` links the notification to the comment the mention came from,
    so mentions in comments are distinguishable from mentions in the note body.
    ``previous_content`` suppresses users who were already mentioned before an
    edit, so editing around an existing mention does not re-notify.

    Returns the rows created, for the caller to hand to ``deliver_emails``
    once it has committed.
    """
    mentioned = await find_mentioned_users(db, content)
    if not mentioned:
        return []

    if previous_content is not None:
        already = {
            user.id for user in await find_mentioned_users(db, previous_content)
        }
        mentioned = [user for user in mentioned if user.id not in already]

    created: list[Notification] = []
    for user in mentioned:
        # One mention notification per user per note-or-comment.
        existing = await db.execute(
            select(Notification).where(
                Notification.type == NotificationType.mention,
                Notification.note_id == note_id,
                Notification.recipient_id == user.id,
                Notification.comment_id == comment_id,
            )
        )
        if existing.scalar_one_or_none() is not None:
            continue

        notification = Notification(
            recipient_id=user.id,
            type=NotificationType.mention,
            note_id=note_id,
            comment_id=comment_id,
            is_read=False,
            # Stored so the email has something to quote without re-reading the
            # note, and so the body survives a later edit of the note text.
            body=_preview(content),
        )
        db.add(notification)
        created.append(notification)

    return created


def _preview(content: str, limit: int = 240) -> str:
    """A single-line excerpt of note or comment text for email bodies."""
    collapsed = " ".join(content.split())
    if len(collapsed) <= limit:
        return collapsed
    return collapsed[: limit - 1].rstrip() + "…"


async def fire_due_reminders(db: AsyncSession, user_id: uuid.UUID) -> int:
    """Create notifications for the user's reminders that have come due.

    Reminders fire lazily: due ones are materialised whenever the user reads
    their notifications. That keeps firing accurate to within one poll interval
    without a scheduler process, and means reminders that came due while the
    app was down still fire on the next read rather than being missed.

    The author and everyone the reminder was shared with are each notified
    once. Checked, archived and undated reminders never fire — a reminder
    without a due date is a valid to-do that simply never alerts.
    """
    now = datetime.now(timezone.utc)

    already_fired = select(Notification.note_id).where(
        Notification.type == NotificationType.reminder,
        Notification.recipient_id == user_id,
    )

    # A shared reminder fires for its author and for everyone it was shared
    # with, each of them exactly once.
    shared_to_me = select(ReminderShare.note_id).where(
        ReminderShare.user_id == user_id
    )

    due = await db.execute(
        select(Note).where(
            or_(Note.author_id == user_id, Note.id.in_(shared_to_me)),
            Note.is_reminder.is_(True),
            Note.is_checked.is_(False),
            Note.is_archived.is_(False),
            Note.deleted_at.is_(None),
            Note.remind_at.isnot(None),
            Note.remind_at <= now,
            Note.id.notin_(already_fired),
        )
    )

    created: list[Notification] = []
    for note in due.scalars().all():
        notification = Notification(
            recipient_id=user_id,
            type=NotificationType.reminder,
            note_id=note.id,
            is_read=False,
            body=_preview(note.reminder_context or note.content),
        )
        db.add(notification)
        created.append(notification)

    if created:
        await db.commit()
        # Already committed, so emailing here cannot announce a rolled-back row.
        await deliver_emails(db, created)

    return len(created)


# ---------------------------------------------------------------------------
# Generic creation
# ---------------------------------------------------------------------------


async def notify(
    db: AsyncSession,
    *,
    recipient_id: uuid.UUID,
    type: NotificationType,
    note_id: Optional[uuid.UUID] = None,
    comment_id: Optional[uuid.UUID] = None,
    repo_id: Optional[uuid.UUID] = None,
    subject: Optional[str] = None,
    body: Optional[str] = None,
) -> Notification:
    """Add one notification row to the session.

    Does not commit and does not send email — the caller owns the transaction
    and passes the returned row to ``deliver_emails`` afterwards.
    """
    notification = Notification(
        recipient_id=recipient_id,
        type=type,
        note_id=note_id,
        comment_id=comment_id,
        repo_id=repo_id,
        subject=subject,
        body=body,
        is_read=False,
    )
    db.add(notification)
    return notification


# ---------------------------------------------------------------------------
# Repo-scoped events
# ---------------------------------------------------------------------------


async def recipients_for_repo(db: AsyncSession, repo: Repo) -> list[User]:
    """Everyone who should hear about activity on ``repo``.

    Mirrors what ``permission_service.get_user_collection_role`` grants: the
    collection owner, everyone with an explicit access row, and every admin
    (admins are treated as owners of every collection). Deduplicated, because
    an admin may also own the collection.
    """
    collection = await db.get(Collection, repo.collection_id)
    if collection is None:
        return []

    access_user_ids = (
        (
            await db.execute(
                select(CollectionAccess.user_id).where(
                    CollectionAccess.collection_id == collection.id
                )
            )
        )
        .scalars()
        .all()
    )

    wanted = {collection.owner_id, *access_user_ids}

    result = await db.execute(
        select(User).where(or_(User.id.in_(wanted), User.role == "admin"))
    )
    return list(result.scalars().all())


async def notify_repo_event(
    db: AsyncSession,
    *,
    repo: Repo,
    type: NotificationType,
    subject: str,
    body: str,
    exclude_user_id: Optional[uuid.UUID] = None,
    link_repo: bool = True,
    recipients: Optional[Sequence[User]] = None,
) -> list[Notification]:
    """Raise one notification per interested user for a repo-scoped event.

    ``exclude_user_id`` drops the person who caused the event: a professor who
    just added a repo does not need to be told that they added it.

    ``link_repo`` is false for ``repo_removed``. The FK carries
    ``ON DELETE CASCADE``, so keeping a ``repo_id`` there would delete the very
    notification announcing the removal — the repo name lives in ``subject``
    instead.

    ``recipients`` lets a caller raising several events for one repo resolve
    the audience once instead of re-querying it per event.
    """
    if recipients is None:
        recipients = await recipients_for_repo(db, repo)

    created: list[Notification] = []
    for user in recipients:
        if exclude_user_id is not None and user.id == exclude_user_id:
            continue
        created.append(
            await notify(
                db,
                recipient_id=user.id,
                type=type,
                repo_id=repo.id if link_repo else None,
                subject=subject,
                body=body,
            )
        )
    return created


async def notify_health_change(
    db: AsyncSession,
    *,
    repo: Repo,
    previous_status: str | None,
    new_status: str,
) -> list[Notification]:
    """Announce a repo's health falling into red.

    Only the *transition* is news. A repo that was already red and is still red
    would otherwise raise a notification on every sync, which trains people to
    ignore them. Improvements are not announced at all — a team recovering is
    good, and does not need anyone's attention.

    ``previous_status`` of "unknown" counts as a decline: a repo whose first
    indexing comes back red is exactly what an instructor wants flagged.
    """
    if new_status != "red" or previous_status == "red":
        return []

    return await notify_repo_event(
        db,
        repo=repo,
        type=NotificationType.repo_health_declined,
        subject=f"{repo.name} health dropped to red",
        body=(
            f"{repo.name} is now scoring red on its health signals"
            + (
                f" (was {previous_status})."
                if previous_status and previous_status != "unknown"
                else "."
            )
        ),
    )


# ---------------------------------------------------------------------------
# Email delivery
# ---------------------------------------------------------------------------


async def _settings_for(
    db: AsyncSession, user_id: uuid.UUID
) -> Optional[NotificationSetting]:
    result = await db.execute(
        select(NotificationSetting).where(NotificationSetting.user_id == user_id)
    )
    return result.scalar_one_or_none()


def _link_for(notification: Notification) -> str:
    """Where the email should send the reader."""
    base = settings.APP_BASE_URL.rstrip("/")
    if notification.repo_id is not None:
        return f"{base}/repos/{notification.repo_id}"
    return f"{base}/notifications"


def _render(notification: Notification) -> OutboundEmail:
    """Build the message for a notification. Recipient is filled in by caller."""
    subject = notification.subject or _DEFAULT_SUBJECTS.get(
        notification.type, "RepoPulse notification"
    )
    lines = [subject]
    if notification.body:
        lines += ["", notification.body]
    lines += ["", f"View it in RepoPulse: {_link_for(notification)}"]
    return OutboundEmail(to="", subject=subject, text="\n".join(lines))


async def deliver_emails(
    db: AsyncSession, notifications: Iterable[Notification]
) -> int:
    """Email whichever of ``notifications`` their recipients subscribed to.

    Call this only after the notifications are committed. Every failure mode —
    no relay configured, a muted event, a refused connection — is swallowed and
    logged: email is a secondary channel, and the in-app notification has
    already been delivered by the time this runs. Raising here would fail the
    request that caused the event.

    Returns the number of messages actually sent.
    """
    sent = 0
    # One settings lookup per recipient, not per notification.
    cache: dict[uuid.UUID, Optional[NotificationSetting]] = {}

    for notification in notifications:
        if notification.emailed_at is not None:
            continue  # already delivered

        recipient_id = notification.recipient_id
        if recipient_id not in cache:
            cache[recipient_id] = await _settings_for(db, recipient_id)
        setting = cache[recipient_id]

        if setting is None or not setting.is_deliverable():
            continue
        if not setting.is_subscribed(notification.type.value):
            continue

        recipient = await db.get(User, recipient_id)
        if recipient is None or not recipient.email:
            continue

        service = get_email_service(
            setting.transport,
            from_email=setting.from_email or "",
            from_name=setting.from_name,
            smtp_host=setting.smtp_host,
            smtp_port=setting.smtp_port,
            smtp_username=setting.smtp_username,
            smtp_password=setting.smtp_password,
            smtp_encryption=setting.smtp_encryption,
            resend_api_key=setting.resend_api_key,
        )

        message = _render(notification)
        message.to = recipient.email

        try:
            await service.send(message)
        except EmailDeliveryError as exc:
            # emailed_at stays NULL, which is what the settings page reads to
            # tell the user their relay is not working.
            logger.warning(
                "Email relay failed for notification %s (%s): %s",
                notification.id,
                notification.type.value,
                exc,
            )
            continue
        except Exception as exc:  # a transport bug must not break the request
            logger.exception(
                "Unexpected email relay error for notification %s: %s",
                notification.id,
                exc,
            )
            continue

        notification.emailed_at = datetime.now(timezone.utc)
        sent += 1

    if sent:
        await db.commit()

    return sent


async def send_test_email(
    setting: NotificationSetting, recipient_email: str
) -> None:
    """Deliver a one-off probe so a user can verify their relay.

    Raises ``EmailDeliveryError`` on failure — unlike ``deliver_emails``, the
    caller here *wants* the error, because the whole point is to surface a
    misconfiguration.
    """
    service = get_email_service(
        setting.transport,
        from_email=setting.from_email or "",
        from_name=setting.from_name,
        smtp_host=setting.smtp_host,
        smtp_port=setting.smtp_port,
        smtp_username=setting.smtp_username,
        smtp_password=setting.smtp_password,
        smtp_encryption=setting.smtp_encryption,
        resend_api_key=setting.resend_api_key,
    )
    await service.send(
        OutboundEmail(
            to=recipient_email,
            subject="RepoPulse email relay test",
            text=(
                "Your RepoPulse email relay is working.\n\n"
                "If you did not request this test, someone with access to your "
                "RepoPulse account sent it from the notification settings page."
            ),
        )
    )
