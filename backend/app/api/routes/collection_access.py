from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, get_db_session
from app.models.collection import Collection
from app.models.collection_access import CollectionAccess
from app.models.collection_access import CollectionRole as DBCollectionRole
from app.models.user import User
from app.schemas.collection_access import (
    CollectionAccessCreate,
    CollectionAccessListResponse,
    CollectionAccessRead,
)
from app.schemas.errors import ErrorResponse
from app.services.permission_service import (
    can_assign_ta,
    can_manage_collection,
    get_user_collection_role,
)
from app.services.permission_service import CollectionRole

router = APIRouter()


def _build_access_read(access: CollectionAccess, user: User) -> CollectionAccessRead:
    return CollectionAccessRead(
        id=access.id,
        collection_id=access.collection_id,
        user_id=access.user_id,
        user_display_name=user.display_name,
        user_email=user.email,
        user_role=user.role,
        access_role=access.access_role.value,
        created_at=access.created_at,
    )


@router.get(
    "/{collection_id}/access",
    response_model=CollectionAccessListResponse,
    responses={
        401: {"model": ErrorResponse},
        404: {"model": ErrorResponse},
    },
)
async def list_collection_access(
    collection_id: uuid.UUID,
    db: AsyncSession = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user),
) -> CollectionAccessListResponse:
    """List all co-instructors and TAs for a collection."""
    user_id = uuid.UUID(current_user_id)

    # Check access — 404 for outsiders (don't reveal existence)
    role = await get_user_collection_role(db, user_id, collection_id)
    if role is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Collection not found")

    result = await db.execute(
        select(CollectionAccess).where(CollectionAccess.collection_id == collection_id)
    )
    entries = result.scalars().all()

    items = []
    for entry in entries:
        user = await db.get(User, entry.user_id)
        if user:
            items.append(_build_access_read(entry, user))

    return CollectionAccessListResponse(
        items=items,
        total=len(items),
        limit=200,
        offset=0,
    )


@router.post(
    "/{collection_id}/access",
    response_model=CollectionAccessRead,
    status_code=status.HTTP_201_CREATED,
    responses={
        401: {"model": ErrorResponse},
        403: {"model": ErrorResponse},
        404: {"model": ErrorResponse},
        409: {"model": ErrorResponse},
    },
)
async def add_collection_access(
    collection_id: uuid.UUID,
    body: CollectionAccessCreate,
    db: AsyncSession = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user),
) -> CollectionAccessRead:
    """Add a co-instructor or TA to a collection."""
    actor_id = uuid.UUID(current_user_id)

    # 404 for outsiders
    actor_role = await get_user_collection_role(db, actor_id, collection_id)
    if actor_role is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Collection not found")

    # Check permissions based on what role is being added
    if body.access_role == "co_instructor":
        # Only owner/admin can add co-instructors
        if not await can_manage_collection(db, actor_id, collection_id):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
    else:  # ta
        # Owner, co_instructor, or admin can add TAs
        if not await can_assign_ta(db, actor_id, collection_id):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")

    # Check that the target user exists
    target_user = await db.get(User, body.user_id)
    if target_user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    # Check for duplicate
    existing = await db.execute(
        select(CollectionAccess).where(
            CollectionAccess.collection_id == collection_id,
            CollectionAccess.user_id == body.user_id,
        )
    )
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="User already has access to this collection",
        )

    db_role = DBCollectionRole(body.access_role)
    access = CollectionAccess(
        collection_id=collection_id,
        user_id=body.user_id,
        access_role=db_role,
    )
    db.add(access)
    await db.flush()
    await db.commit()
    await db.refresh(access)

    return _build_access_read(access, target_user)


@router.delete(
    "/{collection_id}/access/{target_user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_model=None,
    responses={
        401: {"model": ErrorResponse},
        403: {"model": ErrorResponse},
        404: {"model": ErrorResponse},
    },
)
async def remove_collection_access(
    collection_id: uuid.UUID,
    target_user_id: uuid.UUID,
    db: AsyncSession = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user),
) -> None:
    """Remove a user's access from a collection."""
    actor_id = uuid.UUID(current_user_id)

    # 404 for outsiders
    actor_role = await get_user_collection_role(db, actor_id, collection_id)
    if actor_role is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Collection not found")

    # Find the access entry
    result = await db.execute(
        select(CollectionAccess).where(
            CollectionAccess.collection_id == collection_id,
            CollectionAccess.user_id == target_user_id,
        )
    )
    access = result.scalar_one_or_none()
    if access is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Access entry not found",
        )

    # Check removal permissions based on the target's role
    if access.access_role == DBCollectionRole.co_instructor:
        # Only owner/admin can remove co-instructors
        if actor_role != CollectionRole.owner:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
    else:  # ta
        # Owner, co_instructor, or admin can remove TAs
        if not await can_assign_ta(db, actor_id, collection_id):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")

    await db.delete(access)
    await db.flush()
    await db.commit()
