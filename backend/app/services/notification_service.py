"""Notification creation: @mention parsing, due reminders, and repo events.

Notification rows are only ever created here. Routes call into this module
rather than inserting rows themselves.

Notifications are in-app only. `notify` writes the row and the caller owns the
transaction it lands in.

Every creation path first asks `subscribed_user_ids` who still wants the event.
Muting suppresses the row entirely rather than hiding it afterwards, so a muted
event costs nothing and leaves nothing behind. The check is per recipient: one
repo event can be news for the professor and silence for the TA.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Iterable, Optional, Sequence

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.collection import Collection
from app.models.collection_access import CollectionAccess
from app.models.note import Note
from app.models.notification import Notification, NotificationType
from app.models.notification_preference import (
    DEFAULT_SUBSCRIBED_EVENTS,
    NotificationPreference,
)
from app.models.reminder_share import ReminderShare
from app.models.repo import Repo
from app.models.user import User

# A mention continues while these characters follow, so "@Mark" is not treated
# as a mention of "Mark" when the text actually reads "@Mark_(Instructor)".
_SLUG_CONTINUATION = frozenset("abcdefghijklmnopqrstuvwxyz0123456789_(")


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

    Returns the rows created, without committing.
    """
    mentioned = await find_mentioned_users(db, content)
    if not mentioned:
        return []

    if previous_content is not None:
        already = {
            user.id for user in await find_mentioned_users(db, previous_content)
        }
        mentioned = [user for user in mentioned if user.id not in already]

    subscribed = await subscribed_user_ids(
        db, (user.id for user in mentioned), NotificationType.mention.value
    )
    mentioned = [user for user in mentioned if user.id in subscribed]

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
            # Stored rather than derived, so the quoted text survives a later
            # edit of the note it came from.
            body=_preview(content),
        )
        db.add(notification)
        created.append(notification)

    return created


async def subscribed_user_ids(
    db: AsyncSession,
    user_ids: Iterable[uuid.UUID],
    event: str,
) -> set[uuid.UUID]:
    """Of ``user_ids``, those who still want to hear about ``event``.

    One query however many recipients there are, so a repo event with a dozen
    staff on the collection does not become a dozen lookups.

    Users with no preferences row have never edited their subscriptions and are
    therefore subscribed to everything — the query only has to find the ones who
    explicitly turned this event off.
    """
    wanted = set(user_ids)
    if not wanted:
        return set()

    rows = await db.execute(
        select(
            NotificationPreference.user_id,
            NotificationPreference.subscribed_events,
        ).where(NotificationPreference.user_id.in_(wanted))
    )

    default = DEFAULT_SUBSCRIBED_EVENTS.get(event, False)
    muted = {
        user_id
        for user_id, events in rows.all()
        if events is not None and not events.get(event, default)
    }
    return wanted - muted


def _preview(content: str, limit: int = 240) -> str:
    """A single-line excerpt of note or comment text for notification bodies."""
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

    A user who has muted `reminder` fires nothing. The reminder itself stays on
    their Active reminders list; it just stops raising a notification when it
    comes due.
    """
    if not await subscribed_user_ids(
        db, [user_id], NotificationType.reminder.value
    ):
        return 0

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

    return len(created)


# ---------------------------------------------------------------------------
# Generic creation
# ---------------------------------------------------------------------------


def _add_notification(
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
    """Add the row, no questions asked. Callers gate before reaching here."""
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
) -> Optional[Notification]:
    """Add one notification row to the session, if the recipient wants it.

    Returns the row, or None when the recipient has muted this event — which is
    why the return type is optional rather than the caller assuming a row.

    Does not commit — the caller owns the transaction.
    """
    if recipient_id not in await subscribed_user_ids(db, [recipient_id], type.value):
        return None

    return _add_notification(
        db,
        recipient_id=recipient_id,
        type=type,
        note_id=note_id,
        comment_id=comment_id,
        repo_id=repo_id,
        subject=subject,
        body=body,
    )


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

    Subscriptions are resolved in one query for the whole audience rather than
    per recipient, so muting stays cheap on a collection with a lot of staff.
    """
    if recipients is None:
        recipients = await recipients_for_repo(db, repo)

    audience = [
        user
        for user in recipients
        if exclude_user_id is None or user.id != exclude_user_id
    ]
    subscribed = await subscribed_user_ids(
        db, (user.id for user in audience), type.value
    )

    return [
        _add_notification(
            db,
            recipient_id=user.id,
            type=type,
            repo_id=repo.id if link_repo else None,
            subject=subject,
            body=body,
        )
        for user in audience
        if user.id in subscribed
    ]


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
