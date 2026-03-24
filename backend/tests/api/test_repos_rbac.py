"""Tests for RBAC changes to repos endpoints."""
from __future__ import annotations

import uuid

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import create_access_token
from app.models.collection import Collection
from app.models.collection_access import CollectionAccess, CollectionRole
from app.models.repo import Repo
from app.models.user import User


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def repo_owner(db_session: AsyncSession) -> User:
    user = User(
        id=uuid.uuid4(),
        email="repo_owner@example.com",
        display_name="Repo Owner",
        role="instructor",
        password_hash=None,
    )
    db_session.add(user)
    await db_session.flush()
    return user


@pytest.fixture
def owner_headers(repo_owner: User) -> dict[str, str]:
    token = create_access_token({"sub": str(repo_owner.id)})
    return {"Authorization": f"Bearer {token}"}


@pytest_asyncio.fixture
async def ta_for_repos(db_session: AsyncSession) -> User:
    user = User(
        id=uuid.uuid4(),
        email="ta_repos@example.com",
        display_name="TA for Repos",
        role="ta",
        password_hash=None,
    )
    db_session.add(user)
    await db_session.flush()
    return user


@pytest.fixture
def ta_headers(ta_for_repos: User) -> dict[str, str]:
    token = create_access_token({"sub": str(ta_for_repos.id)})
    return {"Authorization": f"Bearer {token}"}


@pytest_asyncio.fixture
async def outsider(db_session: AsyncSession) -> User:
    user = User(
        id=uuid.uuid4(),
        email="outsider_repos@example.com",
        display_name="Outsider",
        role="instructor",
        password_hash=None,
    )
    db_session.add(user)
    await db_session.flush()
    return user


@pytest.fixture
def outsider_headers(outsider: User) -> dict[str, str]:
    token = create_access_token({"sub": str(outsider.id)})
    return {"Authorization": f"Bearer {token}"}


@pytest_asyncio.fixture
async def repo_collection(
    db_session: AsyncSession, repo_owner: User
) -> Collection:
    col = Collection(
        id=uuid.uuid4(),
        name="Repo Test Collection",
        local_folder_name="repo-test",
        owner_id=repo_owner.id,
    )
    db_session.add(col)
    await db_session.flush()
    return col


@pytest_asyncio.fixture
async def ta_access(
    db_session: AsyncSession, repo_collection: Collection, ta_for_repos: User
) -> CollectionAccess:
    access = CollectionAccess(
        collection_id=repo_collection.id,
        user_id=ta_for_repos.id,
        access_role=CollectionRole.ta,
    )
    db_session.add(access)
    await db_session.flush()
    return access


@pytest_asyncio.fixture
async def sample_repo(
    db_session: AsyncSession, repo_collection: Collection
) -> Repo:
    repo = Repo(
        id=uuid.uuid4(),
        collection_id=repo_collection.id,
        github_url="https://github.com/test/sample",
        name="sample-repo",
        local_path="/tmp/sample-repo",
        health_status="unknown",
    )
    db_session.add(repo)
    await db_session.flush()
    return repo


# ---------------------------------------------------------------------------
# list_repos — access check
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_repos_as_owner(
    test_client: AsyncClient,
    repo_collection: Collection,
    sample_repo: Repo,
    owner_headers: dict,
) -> None:
    resp = await test_client.get(
        f"/api/v1/collections/{repo_collection.id}/repos",
        headers=owner_headers,
    )
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_list_repos_as_ta_with_access(
    test_client: AsyncClient,
    repo_collection: Collection,
    ta_access: CollectionAccess,
    ta_headers: dict,
) -> None:
    resp = await test_client.get(
        f"/api/v1/collections/{repo_collection.id}/repos",
        headers=ta_headers,
    )
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_list_repos_as_outsider_returns_404(
    test_client: AsyncClient,
    repo_collection: Collection,
    outsider_headers: dict,
) -> None:
    resp = await test_client.get(
        f"/api/v1/collections/{repo_collection.id}/repos",
        headers=outsider_headers,
    )
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# get_repo — access check
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_repo_as_outsider_returns_404(
    test_client: AsyncClient,
    sample_repo: Repo,
    outsider_headers: dict,
) -> None:
    resp = await test_client.get(
        f"/api/v1/repos/{sample_repo.id}",
        headers=outsider_headers,
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_get_repo_as_ta_with_access(
    test_client: AsyncClient,
    sample_repo: Repo,
    ta_access: CollectionAccess,
    ta_headers: dict,
) -> None:
    resp = await test_client.get(
        f"/api/v1/repos/{sample_repo.id}",
        headers=ta_headers,
    )
    assert resp.status_code == 200


# ---------------------------------------------------------------------------
# patch_repo — requires write access (not ta)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_patch_repo_as_ta_forbidden(
    test_client: AsyncClient,
    sample_repo: Repo,
    ta_access: CollectionAccess,
    ta_headers: dict,
) -> None:
    resp = await test_client.patch(
        f"/api/v1/repos/{sample_repo.id}",
        headers=ta_headers,
        json={"expected_contributor_count": 3},
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_patch_repo_as_owner_succeeds(
    test_client: AsyncClient,
    sample_repo: Repo,
    owner_headers: dict,
) -> None:
    resp = await test_client.patch(
        f"/api/v1/repos/{sample_repo.id}",
        headers=owner_headers,
        json={"expected_contributor_count": 3},
    )
    assert resp.status_code == 200
    assert resp.json()["expected_contributor_count"] == 3


# ---------------------------------------------------------------------------
# delete_repo — ta can delete
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_delete_repo_as_ta_allowed(
    test_client: AsyncClient,
    db_session: AsyncSession,
    repo_collection: Collection,
    ta_for_repos: User,
    ta_headers: dict,
    ta_access: CollectionAccess,
) -> None:
    repo = Repo(
        id=uuid.uuid4(),
        collection_id=repo_collection.id,
        github_url="https://github.com/test/to-delete",
        name="to-delete",
        local_path="/tmp/to-delete",
        health_status="unknown",
    )
    db_session.add(repo)
    await db_session.flush()

    resp = await test_client.delete(
        f"/api/v1/repos/{repo.id}",
        headers=ta_headers,
    )
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_delete_repo_as_outsider_returns_404(
    test_client: AsyncClient,
    sample_repo: Repo,
    outsider_headers: dict,
) -> None:
    resp = await test_client.delete(
        f"/api/v1/repos/{sample_repo.id}",
        headers=outsider_headers,
    )
    assert resp.status_code == 404
