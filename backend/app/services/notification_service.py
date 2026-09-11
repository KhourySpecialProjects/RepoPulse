"""Notification creation: @mention parsing and due-reminder firing.

Notification rows are only ever created here. Routes call into this module
rather than inserting rows themselves.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.note import Note
from app.models.notification import Notification, NotificationType
from app.models.user import User

# A mention continues while these characters follow, so "@Mark" is not treated
# as a mention of "Mark" when the text actually reads "@Mark_(Instructor)".
_SLUG_CONTINUATION = frozenset("abcdefghijklmnopqrstuvwxyz0123456789_(")


def slug_for_display_name(display_name: str) -> str:
    """The @handle for a display name: spaces become underscores."""
    return display_name.replace(" ", "_")


def content_mentions_slug(content: str, slug: str) -> bool:
    """True when ``content`` contains ``@slug`` as a complete mention.

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
) -> int:
    """Create a mention notification for every user named in ``content``.

    ``comment_id`` links the notification to the comment the mention came from,
    so mentions in comments are distinguishable from mentions in the note body.
    ``previous_content`` suppresses users who were already mentioned before an
    edit, so editing around an existing mention does not re-notify.
    """
    mentioned = await find_mentioned_users(db, content)
    if not mentioned:
        return 0

    if previous_content is not None:
        already = {
            user.id for user in await find_mentioned_users(db, previous_content)
        }
        mentioned = [user for user in mentioned if user.id not in already]

    created = 0
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

        db.add(
            Notification(
                recipient_id=user.id,
                type=NotificationType.mention,
                note_id=note_id,
                comment_id=comment_id,
                is_read=False,
            )
        )
        created += 1

    return created


async def fire_due_reminders(db: AsyncSession, user_id: uuid.UUID) -> int:
    """Create notifications for the user's reminders that have come due.

    Reminders fire lazily: due ones are materialised whenever the user reads
    their notifications. That keeps firing accurate to within one poll interval
    without a scheduler process, and means reminders that came due while the
    app was down still fire on the next read rather than being missed.

    Only the reminder's author is notified. Checked, archived and undated
    reminders never fire, and each reminder fires at most once.
    """
    now = datetime.now(timezone.utc)

    already_fired = select(Notification.note_id).where(
        Notification.type == NotificationType.reminder,
        Notification.recipient_id == user_id,
    )

    due = await db.execute(
        select(Note).where(
            Note.author_id == user_id,
            Note.is_reminder.is_(True),
            Note.is_checked.is_(False),
            Note.is_archived.is_(False),
            Note.deleted_at.is_(None),
            Note.remind_at.isnot(None),
            Note.remind_at <= now,
            Note.id.notin_(already_fired),
        )
    )

    created = 0
    for note in due.scalars().all():
        db.add(
            Notification(
                recipient_id=user_id,
                type=NotificationType.reminder,
                note_id=note.id,
                is_read=False,
            )
        )
        created += 1

    if created:
        await db.commit()

    return created
