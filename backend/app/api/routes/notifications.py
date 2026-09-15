from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, get_db_session
from app.models.note import Note
from app.models.notification import Notification
from app.models.notification_preference import (
    DEFAULT_SUBSCRIBED_EVENTS,
    NotificationPreference,
)
from app.models.reminder_share import ReminderShare
from app.models.user import User
from app.schemas.errors import ErrorResponse
from app.schemas.notification_preferences import (
    NotificationPreferencesRead,
    NotificationPreferencesUpdate,
)
from app.schemas.notifications import (
    NotificationListResponse,
    NotificationRead,
    RecentlyDeletedItem,
    RecentlyDeletedListResponse,
    ReminderListResponse,
    ReminderRead,
)
from app.services.notification_service import fire_due_reminders

router = APIRouter()

# Human labels for the Recently deleted list, keyed by notification type.
NOTIFICATION_LABELS = {
    "mention": "Mention",
    "note_comment": "Comment on your note",
    "reminder": "Reminder due",
    "repo_added": "Repository added",
    "repo_removed": "Repository removed",
    "repo_health_declined": "Repository health declined",
    "pr_opened": "Pull request opened",
    "pr_merged": "Pull request merged",
}


def _notif_to_read(
    notif: Notification,
    note: Note | None = None,
) -> NotificationRead:
    """Build the payload, deriving everything link-related from the note.

    Takes the note itself rather than pre-extracted fields: every caller has
    already loaded it, and each one was repeating the same preview/repo_id
    derivation, so adding `commit_hash` would have meant a fourth copy.
    """
    return NotificationRead(
        id=notif.id,
        type=notif.type.value if hasattr(notif.type, "value") else notif.type,
        note_id=notif.note_id,
        comment_id=notif.comment_id,
        is_read=notif.is_read,
        created_at=notif.created_at,
        note_content_preview=(
            note.content[:80] if note is not None and note.content else None
        ),
        # A repo-scoped event links to its repo directly; a note-scoped one
        # inherits the repo of the note it belongs to.
        repo_id=notif.repo_id or (note.repo_id if note is not None else None),
        commit_hash=note.commit_hash if note is not None else None,
        subject=notif.subject,
        body=notif.body,
    )


@router.get(
    "",
    response_model=NotificationListResponse,
)
async def list_notifications(
    unread_only: bool = Query(False),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user),
) -> NotificationListResponse:
    user_uuid = uuid.UUID(current_user_id)
    await fire_due_reminders(db, user_uuid)

    # Total unread count (always, regardless of pagination/filter)
    unread_count_result = await db.execute(
        select(func.count()).select_from(Notification).where(
            Notification.recipient_id == user_uuid,
            Notification.is_read == False,  # noqa: E712
            Notification.deleted_at.is_(None),
        )
    )
    unread_count = unread_count_result.scalar_one()

    base_q = select(Notification).where(
        Notification.recipient_id == user_uuid,
        Notification.deleted_at.is_(None),
    )
    if unread_only:
        base_q = base_q.where(Notification.is_read == False)  # noqa: E712

    count_result = await db.execute(
        select(func.count()).select_from(Notification).where(
            Notification.recipient_id == user_uuid,
            Notification.deleted_at.is_(None),
            *(
                [Notification.is_read == False]  # noqa: E712
                if unread_only
                else []
            ),
        )
    )
    total = count_result.scalar_one()

    list_q = (
        base_q
        .order_by(Notification.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    result = await db.execute(list_q)
    notifs = result.scalars().all()

    # Bulk-load the notes these notifications point at; everything the client
    # needs to build a link (preview, repo, commit) comes off them.
    note_ids = list({n.note_id for n in notifs if n.note_id is not None})
    note_map: dict[uuid.UUID, Note] = {}
    for nid in note_ids:
        note = await db.get(Note, nid)
        if note:
            note_map[nid] = note

    items = [
        _notif_to_read(
            notif,
            note_map.get(notif.note_id) if notif.note_id else None,
        )
        for notif in notifs
    ]

    return NotificationListResponse(
        items=items,
        total=total,
        unread_count=unread_count,
    )


# ---------------------------------------------------------------------------
# Subscriptions
# ---------------------------------------------------------------------------
#
# Declared before the `/{notification_id}` routes so "preferences" is never
# matched against them.


def _events_for(preference: NotificationPreference | None) -> dict[str, bool]:
    """The user's full event map, defaults under whatever they have saved.

    Merging this way means an event added after the user last saved reads as
    subscribed rather than going missing from the response.
    """
    stored = preference.subscribed_events if preference is not None else None
    return {**DEFAULT_SUBSCRIBED_EVENTS, **(stored or {})}


async def _preference_row(
    db: AsyncSession, user_uuid: uuid.UUID
) -> NotificationPreference | None:
    result = await db.execute(
        select(NotificationPreference).where(
            NotificationPreference.user_id == user_uuid
        )
    )
    return result.scalar_one_or_none()


@router.get("/preferences", response_model=NotificationPreferencesRead)
async def get_notification_preferences(
    db: AsyncSession = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user),
) -> NotificationPreferencesRead:
    """Which events this user currently wants.

    No row is created here: the default is computed, so reading your
    preferences stays a read. The row appears the first time you change one.
    """
    preference = await _preference_row(db, uuid.UUID(current_user_id))
    return NotificationPreferencesRead(subscribed_events=_events_for(preference))


@router.put("/preferences", response_model=NotificationPreferencesRead)
async def update_notification_preferences(
    body: NotificationPreferencesUpdate,
    db: AsyncSession = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user),
) -> NotificationPreferencesRead:
    """Change some subscriptions, leaving the others as they were.

    Scoped to the caller: there is no path by which one user edits another's
    subscriptions, which is what keeps a TA's choices separate from a
    professor's.
    """
    user_uuid = uuid.UUID(current_user_id)
    preference = await _preference_row(db, user_uuid)
    if preference is None:
        preference = NotificationPreference(user_id=user_uuid)
        db.add(preference)

    # Merge, so a client that sends only the checkbox it changed does not
    # silently reset every other event.
    preference.subscribed_events = {
        **_events_for(preference),
        **body.subscribed_events,
    }

    await db.commit()
    await db.refresh(preference)
    return NotificationPreferencesRead(subscribed_events=_events_for(preference))


@router.get(
    "/unread-count",
    response_model=dict,
)
async def get_unread_count(
    db: AsyncSession = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user),
) -> dict:
    user_uuid = uuid.UUID(current_user_id)
    await fire_due_reminders(db, user_uuid)

    result = await db.execute(
        select(func.count()).select_from(Notification).where(
            Notification.recipient_id == user_uuid,
            Notification.is_read == False,  # noqa: E712
            Notification.deleted_at.is_(None),
        )
    )
    count = result.scalar_one()
    return {"unread_count": count}


@router.get(
    "/reminders",
    response_model=ReminderListResponse,
)
async def list_active_reminders(
    db: AsyncSession = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user),
) -> ReminderListResponse:
    """The current user's outstanding reminders, soonest due first.

    Undated reminders sort last so scheduled work leads the list. Reminders are
    created and removed through the notes endpoints; this is the read side of
    the reminders panel.
    """
    user_uuid = uuid.UUID(current_user_id)

    # Mine, plus any that were shared with me.
    shared_to_me = select(ReminderShare.note_id).where(
        ReminderShare.user_id == user_uuid
    )
    result = await db.execute(
        select(Note)
        .where(
            or_(Note.author_id == user_uuid, Note.id.in_(shared_to_me)),
            Note.is_reminder.is_(True),
            Note.is_checked.is_(False),
            Note.is_archived.is_(False),
            Note.deleted_at.is_(None),
        )
        .order_by(Note.remind_at.asc().nullslast(), Note.created_at.desc())
    )
    notes = result.scalars().all()

    items: list[ReminderRead] = []
    for note in notes:
        owner = await db.get(User, note.author_id)
        share_rows = await db.execute(
            select(ReminderShare).where(ReminderShare.note_id == note.id)
        )
        shared_names: list[str] = []
        for share in share_rows.scalars().all():
            shared_user = await db.get(User, share.user_id)
            if shared_user is not None:
                shared_names.append(shared_user.display_name)

        items.append(
            ReminderRead(
                id=note.id,
                content=note.content,
                remind_at=note.remind_at,
                reminder_context=note.reminder_context,
                repo_id=note.repo_id,
                commit_hash=note.commit_hash,
                created_at=note.created_at,
                owner_display_name=owner.display_name if owner else "Unknown",
                shared_with=sorted(shared_names),
                is_owner=note.author_id == user_uuid,
            )
        )

    return ReminderListResponse(items=items, total=len(items))


@router.patch(
    "/{notification_id}/read",
    response_model=NotificationRead,
    responses={404: {"model": ErrorResponse}},
)
async def mark_notification_read(
    notification_id: uuid.UUID,
    db: AsyncSession = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user),
) -> NotificationRead:
    user_uuid = uuid.UUID(current_user_id)

    notif = await db.get(Notification, notification_id)
    if notif is None or notif.recipient_id != user_uuid:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Notification not found",
        )

    notif.is_read = True
    await db.commit()
    await db.refresh(notif)

    note = await db.get(Note, notif.note_id) if notif.note_id else None

    return _notif_to_read(notif, note)


@router.patch(
    "/{notification_id}/unread",
    response_model=NotificationRead,
    responses={404: {"model": ErrorResponse}},
)
async def mark_notification_unread(
    notification_id: uuid.UUID,
    db: AsyncSession = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user),
) -> NotificationRead:
    """Flip a notification back to unread so it can be revisited later."""
    user_uuid = uuid.UUID(current_user_id)

    notif = await db.get(Notification, notification_id)
    if notif is None or notif.recipient_id != user_uuid:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Notification not found",
        )

    notif.is_read = False
    await db.commit()
    await db.refresh(notif)

    note = await db.get(Note, notif.note_id) if notif.note_id else None

    return _notif_to_read(notif, note)


@router.post(
    "/mark-all-unread",
    response_model=dict,
)
async def mark_all_notifications_unread(
    db: AsyncSession = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user),
) -> dict:
    """Mark every live notification unread. Recently deleted ones are skipped."""
    user_uuid = uuid.UUID(current_user_id)

    result = await db.execute(
        select(Notification).where(
            Notification.recipient_id == user_uuid,
            Notification.is_read == True,  # noqa: E712
            Notification.deleted_at.is_(None),
        )
    )
    read_notifs = result.scalars().all()
    count = len(read_notifs)
    for notif in read_notifs:
        notif.is_read = False
    await db.commit()

    return {"marked_unread": count}


@router.post(
    "/mark-all-read",
    response_model=dict,
)
async def mark_all_notifications_read(
    db: AsyncSession = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user),
) -> dict:
    user_uuid = uuid.UUID(current_user_id)

    result = await db.execute(
        select(Notification).where(
            Notification.recipient_id == user_uuid,
            Notification.is_read == False,  # noqa: E712
            Notification.deleted_at.is_(None),
        )
    )
    unread_notifs = result.scalars().all()
    count = len(unread_notifs)
    for notif in unread_notifs:
        notif.is_read = True
    await db.commit()

    return {"marked_read": count}


@router.get(
    "/recently-deleted",
    response_model=RecentlyDeletedListResponse,
)
async def list_recently_deleted(
    db: AsyncSession = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user),
) -> RecentlyDeletedListResponse:
    """Soft-deleted notifications and reminders, most recently deleted first.

    Both kinds share one list so the UI can offer a single undo surface.
    """
    user_uuid = uuid.UUID(current_user_id)

    notif_rows = await db.execute(
        select(Notification).where(
            Notification.recipient_id == user_uuid,
            Notification.deleted_at.isnot(None),
        )
    )
    items: list[RecentlyDeletedItem] = []
    for notif in notif_rows.scalars().all():
        detail = None
        if notif.note_id:
            note = await db.get(Note, notif.note_id)
            if note and note.content:
                detail = note.content[:80]
        items.append(
            RecentlyDeletedItem(
                id=notif.id,
                kind="notification",
                label=NOTIFICATION_LABELS.get(
                    notif.type.value if hasattr(notif.type, "value") else notif.type,
                    "Notification",
                ),
                detail=detail,
                deleted_at=notif.deleted_at,
            )
        )

    note_rows = await db.execute(
        select(Note).where(
            Note.author_id == user_uuid,
            Note.is_reminder.is_(True),
            Note.deleted_at.isnot(None),
        )
    )
    for note in note_rows.scalars().all():
        items.append(
            RecentlyDeletedItem(
                id=note.id,
                kind="reminder",
                label="Reminder",
                detail=note.content[:80] if note.content else None,
                deleted_at=note.deleted_at,
            )
        )

    items.sort(key=lambda item: item.deleted_at, reverse=True)
    return RecentlyDeletedListResponse(items=items, total=len(items))


async def _own_notification(
    db: AsyncSession, notification_id: uuid.UUID, user_uuid: uuid.UUID
) -> Notification:
    notif = await db.get(Notification, notification_id)
    if notif is None or notif.recipient_id != user_uuid:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Notification not found",
        )
    return notif


@router.delete(
    "/{notification_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_model=None,
    responses={404: {"model": ErrorResponse}},
)
async def dismiss_notification(
    notification_id: uuid.UUID,
    db: AsyncSession = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user),
) -> None:
    """Move a notification to Recently deleted rather than destroying it."""
    user_uuid = uuid.UUID(current_user_id)
    notif = await _own_notification(db, notification_id, user_uuid)

    notif.deleted_at = datetime.now(timezone.utc)
    await db.commit()


@router.post(
    "/{notification_id}/restore",
    response_model=NotificationRead,
    responses={404: {"model": ErrorResponse}},
)
async def restore_notification(
    notification_id: uuid.UUID,
    db: AsyncSession = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user),
) -> NotificationRead:
    user_uuid = uuid.UUID(current_user_id)
    notif = await _own_notification(db, notification_id, user_uuid)

    notif.deleted_at = None
    await db.commit()
    await db.refresh(notif)

    note = await db.get(Note, notif.note_id) if notif.note_id else None

    return _notif_to_read(notif, note)


@router.delete(
    "/{notification_id}/permanent",
    status_code=status.HTTP_204_NO_CONTENT,
    response_model=None,
    responses={404: {"model": ErrorResponse}},
)
async def purge_notification(
    notification_id: uuid.UUID,
    db: AsyncSession = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user),
) -> None:
    """Destroy a notification for good. The note it points at is untouched."""
    user_uuid = uuid.UUID(current_user_id)
    notif = await _own_notification(db, notification_id, user_uuid)

    await db.delete(notif)
    await db.commit()
