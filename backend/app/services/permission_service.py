"""Permission service: role checks for collections and users."""
from __future__ import annotations

import uuid
from enum import Enum

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.collection import Collection
from app.models.collection_access import CollectionAccess
from app.models.collection_access import CollectionRole as _DBCollectionRole
from app.models.user import User


class UserRole(str, Enum):
    admin = "admin"
    instructor = "instructor"
    ta = "ta"


class CollectionRole(str, Enum):
    owner = "owner"
    co_instructor = "co_instructor"
    ta = "ta"


async def get_user(db: AsyncSession, user_id: uuid.UUID) -> User | None:
    """Helper to fetch a user by ID."""
    return await db.get(User, user_id)


async def get_user_collection_role(
    db: AsyncSession, user_id: uuid.UUID, collection_id: uuid.UUID
) -> CollectionRole | None:
    """Return the user's effective role in a collection, or None if no access.

    Priority:
    - admin role → owner (full power regardless of ownership)
    - collection.owner_id == user_id → owner
    - CollectionAccess row with access_role=co_instructor → co_instructor
    - CollectionAccess row with access_role=ta → ta
    - Otherwise → None
    """
    user = await db.get(User, user_id)
    if user is None:
        return None

    if user.role == "admin":
        return CollectionRole.owner

    collection = await db.get(Collection, collection_id)
    if collection is None:
        return None

    if collection.owner_id == user_id:
        return CollectionRole.owner

    result = await db.execute(
        select(CollectionAccess).where(
            CollectionAccess.collection_id == collection_id,
            CollectionAccess.user_id == user_id,
        )
    )
    access = result.scalar_one_or_none()
    if access is None:
        return None

    if access.access_role == _DBCollectionRole.co_instructor:
        return CollectionRole.co_instructor
    if access.access_role == _DBCollectionRole.ta:
        return CollectionRole.ta

    return None


async def can_access_collection(
    db: AsyncSession, user_id: uuid.UUID, collection_id: uuid.UUID
) -> bool:
    """True if the user has any role in the collection."""
    role = await get_user_collection_role(db, user_id, collection_id)
    return role is not None


async def can_write_collection(
    db: AsyncSession, user_id: uuid.UUID, collection_id: uuid.UUID
) -> bool:
    """True for owner, co_instructor, or admin. NOT ta."""
    role = await get_user_collection_role(db, user_id, collection_id)
    return role in (CollectionRole.owner, CollectionRole.co_instructor)


async def can_manage_collection(
    db: AsyncSession, user_id: uuid.UUID, collection_id: uuid.UUID
) -> bool:
    """True for owner or admin only (not co_instructor, not ta)."""
    role = await get_user_collection_role(db, user_id, collection_id)
    return role == CollectionRole.owner


async def can_assign_ta(
    db: AsyncSession, user_id: uuid.UUID, collection_id: uuid.UUID
) -> bool:
    """True for owner, co_instructor, or admin."""
    role = await get_user_collection_role(db, user_id, collection_id)
    return role in (CollectionRole.owner, CollectionRole.co_instructor)


async def get_accessible_collection_ids(
    db: AsyncSession, user_id: uuid.UUID
) -> list[uuid.UUID]:
    """Return all collection IDs the user can access."""
    user = await db.get(User, user_id)
    if user is None:
        return []

    if user.role == "admin":
        result = await db.execute(select(Collection.id))
        return list(result.scalars().all())

    # Owned collections
    owned_result = await db.execute(
        select(Collection.id).where(Collection.owner_id == user_id)
    )
    owned_ids = set(owned_result.scalars().all())

    # Collections via CollectionAccess
    access_result = await db.execute(
        select(CollectionAccess.collection_id).where(
            CollectionAccess.user_id == user_id
        )
    )
    access_ids = set(access_result.scalars().all())

    return list(owned_ids | access_ids)
