from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, get_db_session
from app.models.note import Note
from app.models.notification import Notification
from app.schemas.errors import ErrorResponse
from app.schemas.notifications import (
    NotificationListResponse,
    NotificationRead,
    ReminderListResponse,
    ReminderRead,
)
from app.services.notification_service import fire_due_reminders

router = APIRouter()


def _notif_to_read(
    notif: Notification,
    note_content_preview: str | None = None,
    repo_id: uuid.UUID | None = None,
) -> NotificationRead:
    return NotificationRead(
        id=notif.id,
        type=notif.type.value if hasattr(notif.type, "value") else notif.type,
        note_id=notif.note_id,
        comment_id=notif.comment_id,
        is_read=notif.is_read,
        created_at=notif.created_at,
        note_content_preview=note_content_preview,
        repo_id=repo_id,
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
        )
    )
    unread_count = unread_count_result.scalar_one()

    base_q = select(Notification).where(Notification.recipient_id == user_uuid)
    if unread_only:
        base_q = base_q.where(Notification.is_read == False)  # noqa: E712

    count_result = await db.execute(
        select(func.count()).select_from(Notification).where(
            Notification.recipient_id == user_uuid,
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

    # Bulk-load note previews and repo_ids
    note_ids = list({n.note_id for n in notifs if n.note_id is not None})
    note_map: dict[uuid.UUID, Note] = {}
    for nid in note_ids:
        note = await db.get(Note, nid)
        if note:
            note_map[nid] = note

    items = []
    for notif in notifs:
        preview = None
        repo_id = None
        if notif.note_id and notif.note_id in note_map:
            note = note_map[notif.note_id]
            preview = note.content[:80] if note.content else None
            repo_id = note.repo_id
        items.append(_notif_to_read(notif, preview, repo_id))

    return NotificationListResponse(
        items=items,
        total=total,
        unread_count=unread_count,
    )


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

    result = await db.execute(
        select(Note)
        .where(
            Note.author_id == user_uuid,
            Note.is_reminder.is_(True),
            Note.is_checked.is_(False),
            Note.is_archived.is_(False),
        )
        .order_by(Note.remind_at.asc().nullslast(), Note.created_at.desc())
    )
    notes = result.scalars().all()

    return ReminderListResponse(
        items=[
            ReminderRead(
                id=note.id,
                content=note.content,
                remind_at=note.remind_at,
                reminder_context=note.reminder_context,
                repo_id=note.repo_id,
                commit_hash=note.commit_hash,
                created_at=note.created_at,
            )
            for note in notes
        ],
        total=len(notes),
    )


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

    preview = None
    repo_id = None
    if notif.note_id:
        note = await db.get(Note, notif.note_id)
        if note:
            preview = note.content[:80] if note.content else None
            repo_id = note.repo_id

    return _notif_to_read(notif, preview, repo_id)


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
        )
    )
    unread_notifs = result.scalars().all()
    count = len(unread_notifs)
    for notif in unread_notifs:
        notif.is_read = True
    await db.commit()

    return {"marked_read": count}
