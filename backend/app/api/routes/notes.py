from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, get_db_session
from app.models.note import Note
from app.models.note_comment import NoteComment
from app.models.repo import Repo
from app.models.user import User
from app.schemas.errors import ErrorResponse
from app.schemas.notes import NoteCommentRead, NoteCreate, NoteRead, NoteUpdate, PaginatedNotes
from app.services.notification_service import create_mention_notifications
from app.services.permission_service import can_access_collection

router = APIRouter()


def _comment_to_read(comment: NoteComment, author_display_name: str) -> NoteCommentRead:
    return NoteCommentRead(
        id=comment.id,
        note_id=comment.note_id,
        author_id=comment.author_id,
        author_display_name=author_display_name,
        content=comment.content,
        created_at=comment.created_at,
        updated_at=comment.updated_at,
    )


def _note_to_read(
    note: Note,
    display_name: str,
    comments: list[NoteCommentRead] | None = None,
) -> NoteRead:
    return NoteRead(
        id=note.id,
        author_id=note.author_id,
        author_display_name=display_name,
        repo_id=note.repo_id,
        contributor_id=note.contributor_id,
        content=note.content,
        commit_hash=note.commit_hash,
        is_reminder=note.is_reminder,
        reminder_context=note.reminder_context,
        remind_at=note.remind_at,
        is_checked=note.is_checked,
        is_archived=note.is_archived,
        created_at=note.created_at,
        updated_at=note.updated_at,
        comments=comments or [],
    )


async def _build_note_read(note: Note, db: AsyncSession) -> NoteRead:
    """Build a NoteRead, looking up author name and assembling comments."""
    author = await db.get(User, note.author_id)
    author_name = author.display_name if author else "Unknown"

    comment_reads: list[NoteCommentRead] = []
    for comment in note.comments:
        comment_author = await db.get(User, comment.author_id)
        comment_author_name = comment_author.display_name if comment_author else "Unknown"
        comment_reads.append(_comment_to_read(comment, comment_author_name))

    return _note_to_read(note, author_name, comment_reads)


@router.get(
    "/notes",
    response_model=PaginatedNotes,
)
async def list_notes(
    repo_id: Optional[uuid.UUID] = Query(None),
    contributor_id: Optional[uuid.UUID] = Query(None),
    commit_hash: Optional[str] = Query(None),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user),
) -> PaginatedNotes:
    user_uuid = uuid.UUID(current_user_id)

    if repo_id is not None:
        # Verify access to the collection containing this repo
        repo = await db.get(Repo, repo_id)
        if repo is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Repo not found",
            )
        has_access = await can_access_collection(db, user_uuid, repo.collection_id)
        if not has_access:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have access to this collection",
            )
        # Return ALL notes for the repo (all authors)
        query = select(Note).where(Note.repo_id == repo_id)
        if commit_hash is not None:
            query = query.where(Note.commit_hash == commit_hash)
    elif contributor_id is not None:
        query = select(Note).where(
            Note.contributor_id == contributor_id,
            Note.author_id == user_uuid,
        )
        if commit_hash is not None:
            query = query.where(Note.commit_hash == commit_hash)
    else:
        # Global/scratchpad notes for the current user only
        query = select(Note).where(
            Note.author_id == user_uuid,
            Note.repo_id == None,  # noqa: E711
        )
        if commit_hash is not None:
            query = query.where(Note.commit_hash == commit_hash)

    # Soft-deleted notes live only in the Recently deleted list
    query = query.where(Note.deleted_at.is_(None))

    result = await db.execute(query.order_by(Note.created_at.desc()))
    all_notes = result.scalars().all()
    total = len(all_notes)
    page = all_notes[offset : offset + limit]

    items = [await _build_note_read(n, db) for n in page]

    return PaginatedNotes(
        items=items,
        total=total,
        limit=limit,
        offset=offset,
    )


@router.post(
    "/notes",
    response_model=NoteRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_note(
    body: NoteCreate,
    db: AsyncSession = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user),
) -> NoteRead:
    author_uuid = uuid.UUID(current_user_id)
    author = await db.get(User, author_uuid)
    author_name = author.display_name if author else "Unknown"
    note = Note(
        author_id=author_uuid,
        repo_id=body.repo_id,
        contributor_id=body.contributor_id,
        content=body.content,
        commit_hash=body.commit_hash,
        is_reminder=body.is_reminder,
        reminder_context=body.reminder_context,
        remind_at=body.remind_at,
    )
    db.add(note)
    await db.commit()
    await db.refresh(note)

    # Create mention notifications
    await create_mention_notifications(db, body.content, note.id, author_uuid)
    await db.commit()

    return _note_to_read(note, author_name)


@router.patch(
    "/notes/{note_id}",
    response_model=NoteRead,
    responses={404: {"model": ErrorResponse}},
)
async def update_note(
    note_id: uuid.UUID,
    body: NoteUpdate,
    db: AsyncSession = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user),
) -> NoteRead:
    user_uuid = uuid.UUID(current_user_id)

    note = await db.get(Note, note_id)
    if note is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Note not found",
        )

    # Determine if this user has access to the note at all
    # For repo notes, check collection access; for global notes, only author
    if note.repo_id is not None:
        repo = await db.get(Repo, note.repo_id)
        if repo is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Note not found",
            )
        has_access = await can_access_collection(db, user_uuid, repo.collection_id)
        if not has_access:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Note not found",
            )
    else:
        if note.author_id != user_uuid:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Note not found",
            )

    update_data = body.model_dump(exclude_unset=True)

    # Author-only fields: content, is_reminder, reminder_context, is_archived
    author_only_fields = {"content", "is_reminder", "reminder_context", "is_archived"}
    restricted_fields = {k for k in update_data if k in author_only_fields}

    if restricted_fields:
        # Check if current user is the author or admin
        current_user = await db.get(User, user_uuid)
        is_author = note.author_id == user_uuid
        is_admin = current_user is not None and current_user.role == "admin"
        if not is_author and not is_admin:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only the note author or an admin can edit this field",
            )

    old_content = note.content
    for field, value in update_data.items():
        setattr(note, field, value)

    await db.commit()
    await db.refresh(note)

    # If content changed, trigger mention notifications for new mentions
    new_content = update_data.get("content")
    if new_content and new_content != old_content:
        # Find mentions in old content to avoid re-notifying
        await create_mention_notifications(
            db, new_content, note.id, user_uuid, previous_content=old_content
        )
        await db.commit()

    return await _build_note_read(note, db)


@router.delete(
    "/notes/{note_id}",
    responses={404: {"model": ErrorResponse}},
)
async def delete_note(
    note_id: uuid.UUID,
    db: AsyncSession = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user),
) -> dict:
    user_uuid = uuid.UUID(current_user_id)

    note = await db.get(Note, note_id)
    if note is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Note not found",
        )

    current_user = await db.get(User, user_uuid)
    is_author = note.author_id == user_uuid
    is_admin = current_user is not None and current_user.role == "admin"

    if not is_author and not is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the note author or an admin can delete this note",
        )

    # Soft delete, so an accidental deletion can be undone from the
    # Recently deleted list. Use /notes/{id}/permanent to destroy it.
    note.deleted_at = datetime.now(timezone.utc)
    await db.commit()
    return {"detail": "Note deleted"}


async def _own_note_or_admin(
    db: AsyncSession, note_id: uuid.UUID, user_uuid: uuid.UUID
) -> Note:
    note = await db.get(Note, note_id)
    if note is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Note not found",
        )

    current_user = await db.get(User, user_uuid)
    is_author = note.author_id == user_uuid
    is_admin = current_user is not None and current_user.role == "admin"
    if not is_author and not is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the note author or an admin can change this note",
        )
    return note


@router.post(
    "/notes/{note_id}/restore",
    response_model=NoteRead,
    responses={403: {"model": ErrorResponse}, 404: {"model": ErrorResponse}},
)
async def restore_note(
    note_id: uuid.UUID,
    db: AsyncSession = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user),
) -> NoteRead:
    user_uuid = uuid.UUID(current_user_id)
    note = await _own_note_or_admin(db, note_id, user_uuid)

    note.deleted_at = None
    await db.commit()
    await db.refresh(note)

    return await _build_note_read(note, db)


@router.delete(
    "/notes/{note_id}/permanent",
    status_code=status.HTTP_204_NO_CONTENT,
    response_model=None,
    responses={403: {"model": ErrorResponse}, 404: {"model": ErrorResponse}},
)
async def purge_note(
    note_id: uuid.UUID,
    db: AsyncSession = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user),
) -> None:
    """Destroy a note for good, along with its comments and notifications."""
    user_uuid = uuid.UUID(current_user_id)
    note = await _own_note_or_admin(db, note_id, user_uuid)

    await db.delete(note)
    await db.commit()
