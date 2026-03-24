from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from passlib.hash import bcrypt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, get_db_session
from app.models.user import User
from app.schemas.errors import ErrorResponse
from app.schemas.users import (
    ChangePassword,
    PatchMeRequest,
    PasswordReset,
    UserCreate,
    UserDetail,
    UserListResponse,
    UserRead,
    UserUpdate,
)
from app.services.permission_service import get_accessible_collection_ids

router = APIRouter()


def _to_user_read(user: User) -> UserRead:
    return UserRead.model_validate(user)


def _to_user_detail(user: User) -> UserDetail:
    data = UserRead.model_validate(user).model_dump()
    data["github_token_configured"] = bool(user.github_token)
    return UserDetail(**data)


async def _get_user_or_404(db: AsyncSession, user_id: uuid.UUID) -> User:
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return user


async def _require_admin(db: AsyncSession, current_user_id: str) -> User:
    me = await db.get(User, uuid.UUID(current_user_id))
    if me is None or me.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
    return me


@router.get(
    "/users/me",
    response_model=UserDetail,
    responses={401: {"model": ErrorResponse}},
)
async def get_me(
    db: AsyncSession = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user),
) -> UserDetail:
    """Get the current user's own profile."""
    user = await _get_user_or_404(db, uuid.UUID(current_user_id))
    return _to_user_detail(user)


@router.patch(
    "/users/me",
    response_model=UserDetail,
    responses={400: {"model": ErrorResponse}, 401: {"model": ErrorResponse}},
)
async def patch_me(
    body: PatchMeRequest,
    db: AsyncSession = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user),
) -> UserDetail:
    """Update own profile: display_name, github_token, or change password."""
    user = await _get_user_or_404(db, uuid.UUID(current_user_id))

    if body.display_name is not None:
        user.display_name = body.display_name

    if body.github_token is not None:
        # Empty string clears the token
        user.github_token = body.github_token if body.github_token else None

    if body.change_password is not None:
        cp: ChangePassword = body.change_password
        if not user.password_hash or not bcrypt.verify(cp.current_password, user.password_hash):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Current password is incorrect",
            )
        user.password_hash = bcrypt.hash(cp.new_password)

    await db.flush()
    await db.refresh(user)
    return _to_user_detail(user)


@router.get(
    "/users",
    response_model=UserListResponse,
    responses={401: {"model": ErrorResponse}},
)
async def list_users(
    collection_id: uuid.UUID | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user),
) -> UserListResponse:
    """List users. Admin sees all; others see users in shared collections."""
    me = await _get_user_or_404(db, uuid.UUID(current_user_id))

    stmt = select(User).order_by(User.display_name)

    if me.role == "admin":
        if collection_id is not None:
            # Filter to users with access to this collection
            accessible_ids = await _users_in_collection(db, collection_id)
            stmt = stmt.where(User.id.in_(accessible_ids))
    else:
        if collection_id is not None:
            accessible_ids = await _users_in_collection(db, collection_id)
            stmt = stmt.where(User.id.in_(accessible_ids))
        else:
            # Non-admin: only see users in collections they share
            my_collection_ids = await get_accessible_collection_ids(db, me.id)
            if not my_collection_ids:
                return UserListResponse(items=[], total=0, limit=limit, offset=offset)
            visible_user_ids = await _users_in_collections(db, my_collection_ids)
            stmt = stmt.where(User.id.in_(visible_user_ids))

    result = await db.execute(stmt)
    users = result.scalars().all()
    total = len(users)
    page = users[offset : offset + limit]
    return UserListResponse(
        items=[_to_user_read(u) for u in page],
        total=total,
        limit=limit,
        offset=offset,
    )


async def _users_in_collection(db: AsyncSession, collection_id: uuid.UUID) -> list[uuid.UUID]:
    """Return all user IDs with access to a specific collection (owner + access entries)."""
    from app.models.collection import Collection
    from app.models.collection_access import CollectionAccess

    col = await db.get(Collection, collection_id)
    if col is None:
        return []

    result = await db.execute(
        select(CollectionAccess.user_id).where(
            CollectionAccess.collection_id == collection_id
        )
    )
    access_user_ids = list(result.scalars().all())
    return list({col.owner_id} | set(access_user_ids))


async def _users_in_collections(
    db: AsyncSession, collection_ids: list[uuid.UUID]
) -> list[uuid.UUID]:
    """Return all user IDs with access to any of the given collections."""
    from app.models.collection import Collection
    from app.models.collection_access import CollectionAccess

    if not collection_ids:
        return []

    owner_result = await db.execute(
        select(Collection.owner_id).where(Collection.id.in_(collection_ids))
    )
    owner_ids = set(owner_result.scalars().all())

    access_result = await db.execute(
        select(CollectionAccess.user_id).where(
            CollectionAccess.collection_id.in_(collection_ids)
        )
    )
    access_ids = set(access_result.scalars().all())

    return list(owner_ids | access_ids)


@router.post(
    "/users",
    response_model=UserDetail,
    status_code=status.HTTP_201_CREATED,
    responses={
        403: {"model": ErrorResponse},
        409: {"model": ErrorResponse},
    },
)
async def create_user(
    body: UserCreate,
    db: AsyncSession = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user),
) -> UserDetail:
    """Admin-only: create a new user."""
    await _require_admin(db, current_user_id)

    # Check email uniqueness
    existing = await db.execute(select(User).where(User.email == body.email))
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A user with that email already exists",
        )

    user = User(
        id=uuid.uuid4(),
        email=body.email,
        display_name=body.display_name,
        role=body.role,
        password_hash=bcrypt.hash(body.password),
        github_token=body.github_token or None,
    )
    db.add(user)
    await db.flush()
    await db.refresh(user)
    return _to_user_detail(user)


@router.get(
    "/users/{user_id}",
    response_model=UserRead,
    responses={
        401: {"model": ErrorResponse},
        404: {"model": ErrorResponse},
    },
)
async def get_user(
    user_id: uuid.UUID,
    db: AsyncSession = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user),
) -> UserRead | UserDetail:
    """Get a user. Admin/self see UserDetail; others see UserRead."""
    me = await _get_user_or_404(db, uuid.UUID(current_user_id))
    target = await _get_user_or_404(db, user_id)

    if me.role == "admin" or me.id == target.id:
        return _to_user_detail(target)
    return _to_user_read(target)


@router.patch(
    "/users/{user_id}",
    response_model=UserDetail,
    responses={
        403: {"model": ErrorResponse},
        404: {"model": ErrorResponse},
    },
)
async def update_user(
    user_id: uuid.UUID,
    body: UserUpdate,
    db: AsyncSession = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user),
) -> UserDetail:
    """Admin-only: update a user's display_name, role, or github_token."""
    await _require_admin(db, current_user_id)
    user = await _get_user_or_404(db, user_id)

    if body.display_name is not None:
        user.display_name = body.display_name
    if body.role is not None:
        user.role = body.role
    if body.github_token is not None:
        user.github_token = body.github_token if body.github_token else None

    await db.flush()
    await db.refresh(user)
    return _to_user_detail(user)


@router.delete(
    "/users/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_model=None,
    responses={
        400: {"model": ErrorResponse},
        403: {"model": ErrorResponse},
        404: {"model": ErrorResponse},
    },
)
async def delete_user(
    user_id: uuid.UUID,
    db: AsyncSession = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user),
) -> None:
    """Admin-only: delete a user. Cannot delete self."""
    me = await _require_admin(db, current_user_id)
    if me.id == user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete your own account",
        )
    user = await _get_user_or_404(db, user_id)
    await db.delete(user)
    await db.flush()


@router.post(
    "/users/{user_id}/reset-password",
    response_model=UserRead,
    responses={
        403: {"model": ErrorResponse},
        404: {"model": ErrorResponse},
    },
)
async def reset_password(
    user_id: uuid.UUID,
    body: PasswordReset,
    db: AsyncSession = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user),
) -> UserRead:
    """Admin-only: reset another user's password."""
    await _require_admin(db, current_user_id)
    user = await _get_user_or_404(db, user_id)
    user.password_hash = bcrypt.hash(body.new_password)
    await db.flush()
    return _to_user_read(user)
