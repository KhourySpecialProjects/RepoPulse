"""Outsiders must not reach repo-scoped data through secondary endpoints.

Pull requests, summaries, contributors and note creation all take an id that
identifies a repo. Without an access check they let any authenticated user read
or mutate another instructor's collection.
"""
from __future__ import annotations

import uuid

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import create_access_token
from app.models.collection import Collection
from app.models.contributor import Contributor
from app.models.contributor_alias import ContributorAlias
from app.models.repo import Repo
from app.models.user import User


@pytest_asyncio.fixture
async def xc_owner(db_session: AsyncSession) -> User:
    user = User(
        id=uuid.uuid4(),
        email="xc_owner@example.com",
        display_name="XC Owner",
        role="instructor",
        password_hash=None,
    )
    db_session.add(user)
    await db_session.flush()
    return user


@pytest_asyncio.fixture
async def xc_outsider(db_session: AsyncSession) -> User:
    user = User(
        id=uuid.uuid4(),
        email="xc_outsider@example.com",
        display_name="XC Outsider",
        role="instructor",
        password_hash=None,
    )
    db_session.add(user)
    await db_session.flush()
    return user


@pytest.fixture
def outsider_headers(xc_outsider: User) -> dict[str, str]:
    token = create_access_token({"sub": str(xc_outsider.id)})
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def owner_headers(xc_owner: User) -> dict[str, str]:
    token = create_access_token({"sub": str(xc_owner.id)})
    return {"Authorization": f"Bearer {token}"}


@pytest_asyncio.fixture
async def xc_collection(db_session: AsyncSession, xc_owner: User) -> Collection:
    col = Collection(
        id=uuid.uuid4(),
        name="Private Collection",
        local_folder_name="private-collection",
        owner_id=xc_owner.id,
    )
    db_session.add(col)
    await db_session.flush()
    return col


@pytest_asyncio.fixture
async def xc_repo(db_session: AsyncSession, xc_collection: Collection) -> Repo:
    repo = Repo(
        id=uuid.uuid4(),
        collection_id=xc_collection.id,
        github_url="https://github.com/test/private",
        name="private-repo",
        local_path="/tmp/private-repo",
        health_status="unknown",
    )
    db_session.add(repo)
    await db_session.flush()
    return repo


@pytest_asyncio.fixture
async def xc_contributor(db_session: AsyncSession, xc_repo: Repo) -> Contributor:
    contributor = Contributor(
        id=uuid.uuid4(),
        repo_id=xc_repo.id,
        display_name="Private Student",
    )
    db_session.add(contributor)
    await db_session.flush()
    alias = ContributorAlias(
        id=uuid.uuid4(),
        contributor_id=contributor.id,
        git_email="student@example.com",
        git_name="student",
    )
    db_session.add(alias)
    await db_session.flush()
    return contributor


# ---------------------------------------------------------------------------
# Pull requests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_outsider_cannot_list_pull_requests(
    test_client: AsyncClient, xc_repo: Repo, outsider_headers: dict
) -> None:
    res = await test_client.get(
        f"/api/v1/repos/{xc_repo.id}/pull-requests", headers=outsider_headers
    )
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_outsider_cannot_read_pr_stats(
    test_client: AsyncClient, xc_repo: Repo, outsider_headers: dict
) -> None:
    res = await test_client.get(
        f"/api/v1/repos/{xc_repo.id}/pull-requests/stats", headers=outsider_headers
    )
    assert res.status_code == 404


# ---------------------------------------------------------------------------
# Summaries
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_outsider_cannot_read_repo_summaries(
    test_client: AsyncClient, xc_repo: Repo, outsider_headers: dict
) -> None:
    res = await test_client.get(
        f"/api/v1/repos/{xc_repo.id}/summaries", headers=outsider_headers
    )
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_outsider_cannot_generate_repo_summary(
    test_client: AsyncClient, xc_repo: Repo, outsider_headers: dict
) -> None:
    res = await test_client.post(
        "/api/v1/summaries/generate",
        json={"summary_type": "repo_overview", "repo_id": str(xc_repo.id)},
        headers=outsider_headers,
    )
    assert res.status_code == 404


# ---------------------------------------------------------------------------
# Contributors
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_outsider_cannot_read_contributor(
    test_client: AsyncClient, xc_contributor: Contributor, outsider_headers: dict
) -> None:
    res = await test_client.get(
        f"/api/v1/contributors/{xc_contributor.id}", headers=outsider_headers
    )
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_outsider_cannot_rename_contributor(
    test_client: AsyncClient, xc_contributor: Contributor, outsider_headers: dict
) -> None:
    res = await test_client.put(
        f"/api/v1/contributors/{xc_contributor.id}",
        json={"display_name": "Hijacked"},
        headers=outsider_headers,
    )
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_owner_can_still_rename_contributor(
    test_client: AsyncClient, xc_contributor: Contributor, owner_headers: dict
) -> None:
    res = await test_client.put(
        f"/api/v1/contributors/{xc_contributor.id}",
        json={"display_name": "Renamed Student"},
        headers=owner_headers,
    )
    assert res.status_code == 200
    assert res.json()["display_name"] == "Renamed Student"


@pytest.mark.asyncio
async def test_cannot_merge_contributors_from_different_repos(
    test_client: AsyncClient,
    db_session: AsyncSession,
    xc_collection: Collection,
    xc_repo: Repo,
    xc_contributor: Contributor,
    owner_headers: dict,
) -> None:
    """Merging across repos would corrupt both repos irreversibly."""
    other_repo = Repo(
        id=uuid.uuid4(),
        collection_id=xc_collection.id,
        github_url="https://github.com/test/other",
        name="other-repo",
        local_path="/tmp/other-repo",
        health_status="unknown",
    )
    db_session.add(other_repo)
    await db_session.flush()
    other_contributor = Contributor(
        id=uuid.uuid4(),
        repo_id=other_repo.id,
        display_name="Other Student",
    )
    db_session.add(other_contributor)
    await db_session.flush()

    res = await test_client.post(
        "/api/v1/contributors/merge",
        json={
            "contributor_ids": [str(xc_contributor.id), str(other_contributor.id)],
            "display_name": "Merged",
        },
        headers=owner_headers,
    )
    assert res.status_code == 400


# ---------------------------------------------------------------------------
# Notes
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_outsider_cannot_create_note_on_foreign_repo(
    test_client: AsyncClient, xc_repo: Repo, outsider_headers: dict
) -> None:
    res = await test_client.post(
        "/api/v1/notes",
        json={"repo_id": str(xc_repo.id), "content": "injected note"},
        headers=outsider_headers,
    )
    assert res.status_code == 404
