"""Tests for collection access (RBAC) routes."""
from __future__ import annotations

import uuid

import pytest
import pytest_asyncio

from app.core.auth import create_access_token
from app.models.collection import Collection
from app.models.collection_access import CollectionAccess, CollectionRole
from app.models.user import User


def _auth(user: User) -> dict[str, str]:
    token = create_access_token({"sub": str(user.id)})
    return {"Authorization": f"Bearer {token}"}


@pytest_asyncio.fixture
async def owner(db_session):
    user = User(id=uuid.uuid4(), email="owner_ca@test.com", display_name="Owner", role="instructor")
    db_session.add(user)
    await db_session.flush()
    return user


@pytest_asyncio.fixture
async def co_instructor(db_session):
    user = User(id=uuid.uuid4(), email="coi_ca@test.com", display_name="CoI", role="instructor")
    db_session.add(user)
    await db_session.flush()
    return user


@pytest_asyncio.fixture
async def ta_user(db_session):
    user = User(id=uuid.uuid4(), email="ta_ca@test.com", display_name="TA", role="ta")
    db_session.add(user)
    await db_session.flush()
    return user


@pytest_asyncio.fixture
async def admin_user(db_session):
    user = User(id=uuid.uuid4(), email="admin_ca@test.com", display_name="Admin", role="admin")
    db_session.add(user)
    await db_session.flush()
    return user


@pytest_asyncio.fixture
async def outsider(db_session):
    user = User(id=uuid.uuid4(), email="out_ca@test.com", display_name="Outsider", role="instructor")
    db_session.add(user)
    await db_session.flush()
    return user


@pytest_asyncio.fixture
async def collection(db_session, owner):
    col = Collection(
        id=uuid.uuid4(),
        name="Access Test Collection",
        local_folder_name="access-test",
        owner_id=owner.id,
    )
    db_session.add(col)
    await db_session.flush()
    return col


class TestListCollectionAccess:
    async def test_owner_can_list_access(self, test_client, owner, collection):
        resp = await test_client.get(
            f"/api/v1/collections/{collection.id}/access", headers=_auth(owner)
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "items" in data

    async def test_outsider_gets_404(self, test_client, outsider, collection):
        resp = await test_client.get(
            f"/api/v1/collections/{collection.id}/access", headers=_auth(outsider)
        )
        assert resp.status_code == 404

    async def test_admin_can_list_access(self, test_client, admin_user, collection):
        resp = await test_client.get(
            f"/api/v1/collections/{collection.id}/access", headers=_auth(admin_user)
        )
        assert resp.status_code == 200


class TestAddCollectionAccess:
    async def test_owner_can_add_co_instructor(
        self, test_client, owner, collection, co_instructor
    ):
        resp = await test_client.post(
            f"/api/v1/collections/{collection.id}/access",
            json={"user_id": str(co_instructor.id), "access_role": "co_instructor"},
            headers=_auth(owner),
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["access_role"] == "co_instructor"
        assert data["user_id"] == str(co_instructor.id)

    async def test_owner_can_add_ta(self, test_client, owner, collection, ta_user):
        resp = await test_client.post(
            f"/api/v1/collections/{collection.id}/access",
            json={"user_id": str(ta_user.id), "access_role": "ta"},
            headers=_auth(owner),
        )
        assert resp.status_code == 201

    async def test_co_instructor_can_add_ta(
        self, test_client, owner, co_instructor, collection, ta_user, db_session
    ):
        # Give co_instructor access first
        access = CollectionAccess(
            collection_id=collection.id,
            user_id=co_instructor.id,
            access_role=CollectionRole.co_instructor,
        )
        db_session.add(access)
        await db_session.flush()

        resp = await test_client.post(
            f"/api/v1/collections/{collection.id}/access",
            json={"user_id": str(ta_user.id), "access_role": "ta"},
            headers=_auth(co_instructor),
        )
        assert resp.status_code == 201

    async def test_co_instructor_cannot_add_co_instructor(
        self, test_client, owner, co_instructor, collection, outsider, db_session
    ):
        # Give co_instructor access
        access = CollectionAccess(
            collection_id=collection.id,
            user_id=co_instructor.id,
            access_role=CollectionRole.co_instructor,
        )
        db_session.add(access)
        await db_session.flush()

        resp = await test_client.post(
            f"/api/v1/collections/{collection.id}/access",
            json={"user_id": str(outsider.id), "access_role": "co_instructor"},
            headers=_auth(co_instructor),
        )
        assert resp.status_code == 403

    async def test_ta_cannot_add_anyone(
        self, test_client, owner, ta_user, collection, outsider, db_session
    ):
        access = CollectionAccess(
            collection_id=collection.id,
            user_id=ta_user.id,
            access_role=CollectionRole.ta,
        )
        db_session.add(access)
        await db_session.flush()

        resp = await test_client.post(
            f"/api/v1/collections/{collection.id}/access",
            json={"user_id": str(outsider.id), "access_role": "ta"},
            headers=_auth(ta_user),
        )
        assert resp.status_code == 403

    async def test_outsider_gets_404(self, test_client, outsider, collection, ta_user):
        resp = await test_client.post(
            f"/api/v1/collections/{collection.id}/access",
            json={"user_id": str(ta_user.id), "access_role": "ta"},
            headers=_auth(outsider),
        )
        assert resp.status_code == 404

    async def test_duplicate_access_rejected(
        self, test_client, owner, collection, ta_user, db_session
    ):
        # Add once
        access = CollectionAccess(
            collection_id=collection.id,
            user_id=ta_user.id,
            access_role=CollectionRole.ta,
        )
        db_session.add(access)
        await db_session.flush()

        # Try to add again
        resp = await test_client.post(
            f"/api/v1/collections/{collection.id}/access",
            json={"user_id": str(ta_user.id), "access_role": "ta"},
            headers=_auth(owner),
        )
        assert resp.status_code == 409


class TestDeleteCollectionAccess:
    async def test_owner_can_remove_ta(
        self, test_client, owner, collection, ta_user, db_session
    ):
        access = CollectionAccess(
            collection_id=collection.id,
            user_id=ta_user.id,
            access_role=CollectionRole.ta,
        )
        db_session.add(access)
        await db_session.flush()

        resp = await test_client.delete(
            f"/api/v1/collections/{collection.id}/access/{ta_user.id}",
            headers=_auth(owner),
        )
        assert resp.status_code == 204

    async def test_co_instructor_can_remove_ta(
        self, test_client, owner, co_instructor, collection, ta_user, db_session
    ):
        co_access = CollectionAccess(
            collection_id=collection.id,
            user_id=co_instructor.id,
            access_role=CollectionRole.co_instructor,
        )
        ta_access = CollectionAccess(
            collection_id=collection.id,
            user_id=ta_user.id,
            access_role=CollectionRole.ta,
        )
        db_session.add(co_access)
        db_session.add(ta_access)
        await db_session.flush()

        resp = await test_client.delete(
            f"/api/v1/collections/{collection.id}/access/{ta_user.id}",
            headers=_auth(co_instructor),
        )
        assert resp.status_code == 204

    async def test_co_instructor_cannot_remove_co_instructor(
        self, test_client, owner, co_instructor, collection, outsider, db_session
    ):
        # Make outsider a co-instructor too
        outsider_access = CollectionAccess(
            collection_id=collection.id,
            user_id=outsider.id,
            access_role=CollectionRole.co_instructor,
        )
        co_access = CollectionAccess(
            collection_id=collection.id,
            user_id=co_instructor.id,
            access_role=CollectionRole.co_instructor,
        )
        db_session.add(outsider_access)
        db_session.add(co_access)
        await db_session.flush()

        resp = await test_client.delete(
            f"/api/v1/collections/{collection.id}/access/{outsider.id}",
            headers=_auth(co_instructor),
        )
        assert resp.status_code == 403

    async def test_ta_cannot_remove_anyone(
        self, test_client, owner, ta_user, collection, outsider, db_session
    ):
        ta_access = CollectionAccess(
            collection_id=collection.id,
            user_id=ta_user.id,
            access_role=CollectionRole.ta,
        )
        db_session.add(ta_access)
        await db_session.flush()

        resp = await test_client.delete(
            f"/api/v1/collections/{collection.id}/access/{owner.id}",
            headers=_auth(ta_user),
        )
        assert resp.status_code == 403

    async def test_nonexistent_access_returns_404(
        self, test_client, owner, collection, outsider
    ):
        resp = await test_client.delete(
            f"/api/v1/collections/{collection.id}/access/{outsider.id}",
            headers=_auth(owner),
        )
        assert resp.status_code == 404
