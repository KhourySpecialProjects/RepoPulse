from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, get_db_session
from app.models.note import Note
from app.models.note_comment import NoteComment
from app.models.notification import Notification, NotificationType
from app.models.repo import Repo
from app.models.user import User
from app.schemas.errors import ErrorResponse
from app.schemas.notes import NoteCommentCreate, NoteCommentRead
from app.services.permission_service import can_access_collection

router = APIRouter()


async def _check_note_comment_access(
    db: AsyncSession,
    note: Note,
    user_id: uuid.UUID,
) -> None:
    """Raise 403 if the user has no access to comment on this note.

    - For repo-scoped notes: user must have collection access.
    - For global notes (repo_id is None): only the note author can comment.
    """
    if note.repo_id is None:
        if note.author_id != user_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only the note author can comment on global notes",
            )
    else:
        repo = await db.get(Repo, note.repo_id)
        if repo is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Note not found",
            )
        has_access = await can_access_collection(db, user_id, repo.collection_id)
        if not has_access:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have access to this collection",
            )


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


@router.post(
    "/notes/{note_id}/comments",
    response_model=NoteCommentRead,
    status_code=status.HTTP_201_CREATED,
    responses={
        403: {"model": ErrorResponse},
        404: {"model": ErrorResponse},
    },
)
async def create_comment(
    note_id: uuid.UUID,
    body: NoteCommentCreate,
    db: AsyncSession = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user),
) -> NoteCommentRead:
    user_uuid = uuid.UUID(current_user_id)

    note = await db.get(Note, note_id)
    if note is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Note not found",
        )

    await _check_note_comment_access(db, note, user_uuid)

    author = await db.get(User, user_uuid)
    author_name = author.display_name if author else "Unknown"

    comment = NoteComment(
        note_id=note_id,
        author_id=user_uuid,
        content=body.content,
    )
    db.add(comment)
    await db.commit()
    await db.refresh(comment)

    # Notify the note author if the commenter is someone else
    if note.author_id != user_uuid:
        notif = Notification(
            recipient_id=note.author_id,
            type=NotificationType.note_comment,
            note_id=note_id,
            comment_id=comment.id,
            is_read=False,
        )
        db.add(notif)
        await db.commit()

    return _comment_to_read(comment, author_name)


@router.get(
    "/notes/{note_id}/comments",
    response_model=list[NoteCommentRead],
    responses={
        403: {"model": ErrorResponse},
        404: {"model": ErrorResponse},
    },
)
async def list_comments(
    note_id: uuid.UUID,
    db: AsyncSession = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user),
) -> list[NoteCommentRead]:
    user_uuid = uuid.UUID(current_user_id)

    note = await db.get(Note, note_id)
    if note is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Note not found",
        )

    await _check_note_comment_access(db, note, user_uuid)

    result = await db.execute(
        select(NoteComment)
        .where(NoteComment.note_id == note_id)
        .order_by(NoteComment.created_at.asc())
    )
    comments = result.scalars().all()

    # Bulk-fetch author names
    author_ids = list({c.author_id for c in comments})
    author_map: dict[uuid.UUID, str] = {}
    for aid in author_ids:
        user = await db.get(User, aid)
        author_map[aid] = user.display_name if user else "Unknown"

    return [_comment_to_read(c, author_map.get(c.author_id, "Unknown")) for c in comments]


@router.delete(
    "/notes/{note_id}/comments/{comment_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_model=None,
    responses={
        403: {"model": ErrorResponse},
        404: {"model": ErrorResponse},
    },
)
async def delete_comment(
    note_id: uuid.UUID,
    comment_id: uuid.UUID,
    db: AsyncSession = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user),
) -> None:
    user_uuid = uuid.UUID(current_user_id)

    comment = await db.get(NoteComment, comment_id)
    if comment is None or comment.note_id != note_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Comment not found",
        )

    # Check: comment author or admin
    user = await db.get(User, user_uuid)
    if user is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")

    if comment.author_id != user_uuid and user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the comment author or an admin can delete this comment",
        )

    await db.delete(comment)
    await db.commit()
