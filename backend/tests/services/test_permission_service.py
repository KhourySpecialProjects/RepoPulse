"""Tests for permission_service.py"""
from __future__ import annotations

import uuid

import pytest
import pytest_asyncio

from app.models.collection import Collection
from app.models.collection_access import CollectionAccess, CollectionRole
from app.models.user import User
from app.services.permission_service import (
    can_access_collection,
    can_assign_ta,
    can_manage_collection,
    can_write_collection,
    get_accessible_collection_ids,
    get_user_collection_role,
)


@pytest_asyncio.fixture
async def owner(db_session):
    user = User(id=uuid.uuid4(), email="owner@test.com", display_name="Owner", role="instructor")
    db_session.add(user)
    await db_session.flush()
    return user


@pytest_asyncio.fixture
async def co_instructor(db_session):
    user = User(id=uuid.uuid4(), email="co@test.com", display_name="Co-Instructor", role="instructor")
    db_session.add(user)
    await db_session.flush()
    return user


@pytest_asyncio.fixture
async def ta_user(db_session):
    user = User(id=uuid.uuid4(), email="ta@test.com", display_name="TA", role="ta")
    db_session.add(user)
    await db_session.flush()
    return user


@pytest_asyncio.fixture
async def admin_user(db_session):
    user = User(id=uuid.uuid4(), email="admin@test.com", display_name="Admin", role="admin")
    db_session.add(user)
    await db_session.flush()
    return user


@pytest_asyncio.fixture
async def outsider(db_session):
    user = User(id=uuid.uuid4(), email="other@test.com", display_name="Outsider", role="instructor")
    db_session.add(user)
    await db_session.flush()
    return user


@pytest_asyncio.fixture
async def collection(db_session, owner):
    col = Collection(
        id=uuid.uuid4(),
        name="Test Collection",
        local_folder_name="test-col",
        owner_id=owner.id,
    )
    db_session.add(col)
    await db_session.flush()
    return col


@pytest_asyncio.fixture
async def co_instructor_access(db_session, collection, co_instructor):
    access = CollectionAccess(
        collection_id=collection.id,
        user_id=co_instructor.id,
        access_role=CollectionRole.co_instructor,
    )
    db_session.add(access)
    await db_session.flush()
    return access


@pytest_asyncio.fixture
async def ta_access(db_session, collection, ta_user):
    access = CollectionAccess(
        collection_id=collection.id,
        user_id=ta_user.id,
        access_role=CollectionRole.ta,
    )
    db_session.add(access)
    await db_session.flush()
    return access


class TestGetUserCollectionRole:
    async def test_owner_returns_owner(self, db_session, owner, collection):
        role = await get_user_collection_role(db_session, owner.id, collection.id)
        assert role is not None
        assert role.value == "owner"

    async def test_admin_returns_owner(self, db_session, admin_user, collection):
        role = await get_user_collection_role(db_session, admin_user.id, collection.id)
        assert role is not None
        assert role.value == "owner"

    async def test_co_instructor_returns_co_instructor(
        self, db_session, co_instructor, collection, co_instructor_access
    ):
        role = await get_user_collection_role(db_session, co_instructor.id, collection.id)
        assert role is not None
        assert role.value == "co_instructor"

    async def test_ta_returns_ta(self, db_session, ta_user, collection, ta_access):
        role = await get_user_collection_role(db_session, ta_user.id, collection.id)
        assert role is not None
        assert role.value == "ta"

    async def test_outsider_returns_none(self, db_session, outsider, collection):
        role = await get_user_collection_role(db_session, outsider.id, collection.id)
        assert role is None

    async def test_nonexistent_collection_returns_none(self, db_session, owner):
        role = await get_user_collection_role(db_session, owner.id, uuid.uuid4())
        assert role is None


class TestCanAccessCollection:
    async def test_owner_can_access(self, db_session, owner, collection):
        assert await can_access_collection(db_session, owner.id, collection.id) is True

    async def test_admin_can_access(self, db_session, admin_user, collection):
        assert await can_access_collection(db_session, admin_user.id, collection.id) is True

    async def test_co_instructor_can_access(
        self, db_session, co_instructor, collection, co_instructor_access
    ):
        assert await can_access_collection(db_session, co_instructor.id, collection.id) is True

    async def test_ta_can_access(self, db_session, ta_user, collection, ta_access):
        assert await can_access_collection(db_session, ta_user.id, collection.id) is True

    async def test_outsider_cannot_access(self, db_session, outsider, collection):
        assert await can_access_collection(db_session, outsider.id, collection.id) is False


class TestCanWriteCollection:
    async def test_owner_can_write(self, db_session, owner, collection):
        assert await can_write_collection(db_session, owner.id, collection.id) is True

    async def test_admin_can_write(self, db_session, admin_user, collection):
        assert await can_write_collection(db_session, admin_user.id, collection.id) is True

    async def test_co_instructor_can_write(
        self, db_session, co_instructor, collection, co_instructor_access
    ):
        assert await can_write_collection(db_session, co_instructor.id, collection.id) is True

    async def test_ta_cannot_write(self, db_session, ta_user, collection, ta_access):
        assert await can_write_collection(db_session, ta_user.id, collection.id) is False

    async def test_outsider_cannot_write(self, db_session, outsider, collection):
        assert await can_write_collection(db_session, outsider.id, collection.id) is False


class TestCanManageCollection:
    async def test_owner_can_manage(self, db_session, owner, collection):
        assert await can_manage_collection(db_session, owner.id, collection.id) is True

    async def test_admin_can_manage(self, db_session, admin_user, collection):
        assert await can_manage_collection(db_session, admin_user.id, collection.id) is True

    async def test_co_instructor_cannot_manage(
        self, db_session, co_instructor, collection, co_instructor_access
    ):
        assert await can_manage_collection(db_session, co_instructor.id, collection.id) is False

    async def test_ta_cannot_manage(self, db_session, ta_user, collection, ta_access):
        assert await can_manage_collection(db_session, ta_user.id, collection.id) is False


class TestCanAssignTa:
    async def test_owner_can_assign_ta(self, db_session, owner, collection):
        assert await can_assign_ta(db_session, owner.id, collection.id) is True

    async def test_co_instructor_can_assign_ta(
        self, db_session, co_instructor, collection, co_instructor_access
    ):
        assert await can_assign_ta(db_session, co_instructor.id, collection.id) is True

    async def test_admin_can_assign_ta(self, db_session, admin_user, collection):
        assert await can_assign_ta(db_session, admin_user.id, collection.id) is True

    async def test_ta_cannot_assign_ta(self, db_session, ta_user, collection, ta_access):
        assert await can_assign_ta(db_session, ta_user.id, collection.id) is False


class TestGetAccessibleCollectionIds:
    async def test_owner_gets_own_collections(self, db_session, owner, collection):
        ids = await get_accessible_collection_ids(db_session, owner.id)
        assert collection.id in ids

    async def test_admin_gets_all_collections(self, db_session, admin_user, collection, owner):
        # Create a second collection owned by owner
        col2 = Collection(
            id=uuid.uuid4(),
            name="Another Collection",
            local_folder_name="another-col",
            owner_id=owner.id,
        )
        db_session.add(col2)
        await db_session.flush()

        ids = await get_accessible_collection_ids(db_session, admin_user.id)
        assert collection.id in ids
        assert col2.id in ids

    async def test_co_instructor_gets_granted_collections(
        self, db_session, co_instructor, collection, co_instructor_access
    ):
        ids = await get_accessible_collection_ids(db_session, co_instructor.id)
        assert collection.id in ids

    async def test_ta_gets_granted_collections(self, db_session, ta_user, collection, ta_access):
        ids = await get_accessible_collection_ids(db_session, ta_user.id)
        assert collection.id in ids

    async def test_outsider_gets_empty_list(self, db_session, outsider):
        ids = await get_accessible_collection_ids(db_session, outsider.id)
        assert len(ids) == 0
