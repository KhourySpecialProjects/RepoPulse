"""Tests for RBAC changes to collections endpoints."""
from __future__ import annotations

import uuid

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import create_access_token
from app.models.collection import Collection
from app.models.collection_access import CollectionAccess, CollectionRole
from app.models.user import User


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def ta_user(db_session: AsyncSession) -> User:
    user = User(
        id=uuid.uuid4(),
        email="ta_rbac@example.com",
        display_name="TA User",
        role="ta",
        password_hash=None,
    )
    db_session.add(user)
    await db_session.flush()
    return user


@pytest.fixture
def ta_auth_headers(ta_user: User) -> dict[str, str]:
    token = create_access_token({"sub": str(ta_user.id)})
    return {"Authorization": f"Bearer {token}"}


@pytest_asyncio.fixture
async def admin_user(db_session: AsyncSession) -> User:
    user = User(
        id=uuid.uuid4(),
        email="admin_rbac@example.com",
        display_name="Admin User",
        role="admin",
        password_hash=None,
    )
    db_session.add(user)
    await db_session.flush()
    return user


@pytest.fixture
def admin_auth_headers(admin_user: User) -> dict[str, str]:
    token = create_access_token({"sub": str(admin_user.id)})
    return {"Authorization": f"Bearer {token}"}


@pytest_asyncio.fixture
async def other_user(db_session: AsyncSession) -> User:
    user = User(
        id=uuid.uuid4(),
        email="other_rbac@example.com",
        display_name="Other User",
        role="instructor",
        password_hash=None,
    )
    db_session.add(user)
    await db_session.flush()
    return user


@pytest.fixture
def other_auth_headers(other_user: User) -> dict[str, str]:
    token = create_access_token({"sub": str(other_user.id)})
    return {"Authorization": f"Bearer {token}"}


@pytest_asyncio.fixture
async def owned_collection(
    db_session: AsyncSession, test_user: User
) -> Collection:
    col = Collection(
        id=uuid.uuid4(),
        name="RBAC Test Collection",
        local_folder_name="rbac-test",
        owner_id=test_user.id,
    )
    db_session.add(col)
    await db_session.flush()
    return col


# ---------------------------------------------------------------------------
# list_collections — only accessible collections
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_collections_only_returns_accessible(
    test_client: AsyncClient,
    db_session: AsyncSession,
    auth_headers: dict,
    owned_collection: Collection,
    other_user: User,
    other_auth_headers: dict,
) -> None:
    """other_user cannot see test_user's collection."""
    # test_user can see their own
    own_resp = await test_client.get("/api/v1/collections", headers=auth_headers)
    own_ids = [c["id"] for c in own_resp.json()["items"]]
    assert str(owned_collection.id) in own_ids

    # other_user sees empty list
    other_resp = await test_client.get("/api/v1/collections", headers=other_auth_headers)
    other_ids = [c["id"] for c in other_resp.json()["items"]]
    assert str(owned_collection.id) not in other_ids


@pytest.mark.asyncio
async def test_list_collections_ta_sees_granted_collections(
    test_client: AsyncClient,
    db_session: AsyncSession,
    owned_collection: Collection,
    ta_user: User,
    ta_auth_headers: dict,
) -> None:
    access = CollectionAccess(
        collection_id=owned_collection.id,
        user_id=ta_user.id,
        access_role=CollectionRole.ta,
    )
    db_session.add(access)
    await db_session.flush()

    resp = await test_client.get("/api/v1/collections", headers=ta_auth_headers)
    ids = [c["id"] for c in resp.json()["items"]]
    assert str(owned_collection.id) in ids


@pytest.mark.asyncio
async def test_list_collections_admin_sees_all(
    test_client: AsyncClient,
    owned_collection: Collection,
    admin_auth_headers: dict,
) -> None:
    resp = await test_client.get("/api/v1/collections", headers=admin_auth_headers)
    ids = [c["id"] for c in resp.json()["items"]]
    assert str(owned_collection.id) in ids


# ---------------------------------------------------------------------------
# create_collection — only instructor/admin
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_collection_as_instructor(
    test_client: AsyncClient, auth_headers: dict
) -> None:
    response = await test_client.post(
        "/api/v1/collections",
        headers=auth_headers,
        json={"name": "My Collection", "local_folder_name": "my-col"},
    )
    assert response.status_code == 201


@pytest.mark.asyncio
async def test_create_collection_as_ta_forbidden(
    test_client: AsyncClient, ta_auth_headers: dict
) -> None:
    response = await test_client.post(
        "/api/v1/collections",
        headers=ta_auth_headers,
        json={"name": "TA Collection", "local_folder_name": "ta-col"},
    )
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_create_collection_as_admin(
    test_client: AsyncClient, admin_auth_headers: dict
) -> None:
    response = await test_client.post(
        "/api/v1/collections",
        headers=admin_auth_headers,
        json={"name": "Admin Collection", "local_folder_name": "admin-col"},
    )
    assert response.status_code == 201


# ---------------------------------------------------------------------------
# get_collection — 404 for outsiders
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_collection_as_outsider_returns_404(
    test_client: AsyncClient,
    owned_collection: Collection,
    other_auth_headers: dict,
) -> None:
    resp = await test_client.get(
        f"/api/v1/collections/{owned_collection.id}",
        headers=other_auth_headers,
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_get_collection_as_ta_with_access(
    test_client: AsyncClient,
    db_session: AsyncSession,
    owned_collection: Collection,
    ta_user: User,
    ta_auth_headers: dict,
) -> None:
    access = CollectionAccess(
        collection_id=owned_collection.id,
        user_id=ta_user.id,
        access_role=CollectionRole.ta,
    )
    db_session.add(access)
    await db_session.flush()

    resp = await test_client.get(
        f"/api/v1/collections/{owned_collection.id}",
        headers=ta_auth_headers,
    )
    assert resp.status_code == 200


# ---------------------------------------------------------------------------
# update_collection — requires write access
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_update_collection_as_ta_forbidden(
    test_client: AsyncClient,
    db_session: AsyncSession,
    owned_collection: Collection,
    ta_user: User,
    ta_auth_headers: dict,
) -> None:
    access = CollectionAccess(
        collection_id=owned_collection.id,
        user_id=ta_user.id,
        access_role=CollectionRole.ta,
    )
    db_session.add(access)
    await db_session.flush()

    resp = await test_client.patch(
        f"/api/v1/collections/{owned_collection.id}",
        headers=ta_auth_headers,
        json={"name": "TA Updated"},
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_update_collection_as_owner_succeeds(
    test_client: AsyncClient,
    owned_collection: Collection,
    auth_headers: dict,
) -> None:
    resp = await test_client.patch(
        f"/api/v1/collections/{owned_collection.id}",
        headers=auth_headers,
        json={"name": "Owner Updated"},
    )
    assert resp.status_code == 200
    assert resp.json()["name"] == "Owner Updated"


# ---------------------------------------------------------------------------
# delete_collection — only owner/admin
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_delete_collection_as_outsider_returns_404(
    test_client: AsyncClient,
    owned_collection: Collection,
    other_auth_headers: dict,
) -> None:
    resp = await test_client.delete(
        f"/api/v1/collections/{owned_collection.id}",
        headers=other_auth_headers,
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_delete_collection_as_co_instructor_forbidden(
    test_client: AsyncClient,
    db_session: AsyncSession,
    owned_collection: Collection,
    other_user: User,
    other_auth_headers: dict,
) -> None:
    access = CollectionAccess(
        collection_id=owned_collection.id,
        user_id=other_user.id,
        access_role=CollectionRole.co_instructor,
    )
    db_session.add(access)
    await db_session.flush()

    resp = await test_client.delete(
        f"/api/v1/collections/{owned_collection.id}",
        headers=other_auth_headers,
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_delete_collection_as_admin(
    test_client: AsyncClient,
    owned_collection: Collection,
    admin_auth_headers: dict,
) -> None:
    resp = await test_client.delete(
        f"/api/v1/collections/{owned_collection.id}",
        headers=admin_auth_headers,
    )
    assert resp.status_code == 204
