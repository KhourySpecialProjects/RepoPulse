"""Deleting a parent must take its children with it.

The child FKs (contributors.repo_id, contributor_aliases.contributor_id,
repos.collection_id) are NOT NULL, so without an ORM cascade SQLAlchemy tries
to null them out and the delete fails with a 500. Notes and summaries have
nullable FKs and would instead survive as orphans detached from any repo.
"""
from __future__ import annotations

import uuid

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import create_access_token
from app.models.collection import Collection
from app.models.contributor import Contributor
from app.models.contributor_alias import ContributorAlias
from app.models.note import Note
from app.models.repo import Repo
from app.models.user import User


@pytest_asyncio.fixture
async def cascade_owner(db_session: AsyncSession) -> User:
    user = User(
        id=uuid.uuid4(),
        email="cascade_owner@example.com",
        display_name="Cascade Owner",
        role="instructor",
        password_hash=None,
    )
    db_session.add(user)
    await db_session.flush()
    return user


@pytest.fixture
def owner_headers(cascade_owner: User) -> dict[str, str]:
    token = create_access_token({"sub": str(cascade_owner.id)})
    return {"Authorization": f"Bearer {token}"}


@pytest_asyncio.fixture
async def cascade_collection(db_session: AsyncSession, cascade_owner: User) -> Collection:
    col = Collection(
        id=uuid.uuid4(),
        name="Cascade Collection",
        local_folder_name="cascade-collection",
        owner_id=cascade_owner.id,
    )
    db_session.add(col)
    await db_session.flush()
    return col


@pytest_asyncio.fixture
async def populated_repo(
    db_session: AsyncSession, cascade_collection: Collection, cascade_owner: User
) -> Repo:
    """A repo with the children a real synced repo would have."""
    repo = Repo(
        id=uuid.uuid4(),
        collection_id=cascade_collection.id,
        github_url="https://github.com/test/populated",
        name="populated",
        local_path="/tmp/populated",
        health_status="unknown",
    )
    db_session.add(repo)
    await db_session.flush()

    contributor = Contributor(
        id=uuid.uuid4(), repo_id=repo.id, display_name="Student One"
    )
    db_session.add(contributor)
    await db_session.flush()

    db_session.add(
        ContributorAlias(
            id=uuid.uuid4(),
            contributor_id=contributor.id,
            git_email="student@example.com",
            git_name="student",
        )
    )
    db_session.add(
        Note(
            id=uuid.uuid4(),
            author_id=cascade_owner.id,
            repo_id=repo.id,
            content="Looks good so far",
        )
    )
    await db_session.flush()
    return repo


@pytest.mark.asyncio
async def test_delete_repo_with_contributors_succeeds(
    test_client: AsyncClient, populated_repo: Repo, owner_headers: dict
) -> None:
    res = await test_client.delete(
        f"/api/v1/repos/{populated_repo.id}", headers=owner_headers
    )
    assert res.status_code == 200


@pytest.mark.asyncio
async def test_delete_repo_removes_its_contributors_and_aliases(
    test_client: AsyncClient,
    db_session: AsyncSession,
    populated_repo: Repo,
    owner_headers: dict,
) -> None:
    await test_client.delete(f"/api/v1/repos/{populated_repo.id}", headers=owner_headers)

    contributors = (
        await db_session.execute(
            select(Contributor).where(Contributor.repo_id == populated_repo.id)
        )
    ).scalars().all()
    assert contributors == []

    aliases = (await db_session.execute(select(ContributorAlias))).scalars().all()
    assert aliases == []


@pytest.mark.asyncio
async def test_delete_repo_does_not_orphan_notes(
    test_client: AsyncClient,
    db_session: AsyncSession,
    populated_repo: Repo,
    owner_headers: dict,
) -> None:
    """A note left with repo_id=NULL would resurface as a global note."""
    await test_client.delete(f"/api/v1/repos/{populated_repo.id}", headers=owner_headers)

    orphaned = (
        await db_session.execute(select(Note).where(Note.repo_id.is_(None)))
    ).scalars().all()
    assert orphaned == []


@pytest.mark.asyncio
async def test_delete_collection_with_repos_succeeds(
    test_client: AsyncClient,
    cascade_collection: Collection,
    populated_repo: Repo,
    owner_headers: dict,
) -> None:
    res = await test_client.delete(
        f"/api/v1/collections/{cascade_collection.id}", headers=owner_headers
    )
    assert res.status_code in (200, 204)


@pytest.mark.asyncio
async def test_delete_collection_removes_its_repos(
    test_client: AsyncClient,
    db_session: AsyncSession,
    cascade_collection: Collection,
    populated_repo: Repo,
    owner_headers: dict,
) -> None:
    await test_client.delete(
        f"/api/v1/collections/{cascade_collection.id}", headers=owner_headers
    )

    repos = (
        await db_session.execute(
            select(Repo).where(Repo.collection_id == cascade_collection.id)
        )
    ).scalars().all()
    assert repos == []
