"""A sync belongs to the repo, not to the browser tab that started it.

The spinner used to be local React state with a five-second timeout, so if a
TA kicked off a sync the instructor had no way to tell — the repo simply sat
there looking idle while a clone ran. Sync state therefore has to live on the
Repo row, where every viewer reads it from.

The results were always shared (``_index_repo`` writes health and
``last_synced_at`` to the Repo). It is only the in-flight signal that was
private.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.routes import repos as repos_routes
from app.core.auth import create_access_token
from app.models.collection import Collection
from app.models.collection_access import CollectionAccess, CollectionRole
from app.models.repo import Repo
from app.models.user import User


@pytest_asyncio.fixture
async def instructor(db_session: AsyncSession) -> User:
    user = User(
        id=uuid.uuid4(),
        email="prof_sync@example.com",
        display_name="Professor Plum",
        role="instructor",
        password_hash=None,
    )
    db_session.add(user)
    await db_session.flush()
    return user


@pytest_asyncio.fixture
async def ta(db_session: AsyncSession) -> User:
    user = User(
        id=uuid.uuid4(),
        email="ta_sync@example.com",
        display_name="Tina TA",
        role="ta",
        password_hash=None,
        github_token="ghp_ta_token",
    )
    db_session.add(user)
    await db_session.flush()
    return user


@pytest.fixture
def instructor_headers(instructor: User) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token({'sub': str(instructor.id)})}"}


@pytest.fixture
def ta_headers(ta: User) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token({'sub': str(ta.id)})}"}


@pytest_asyncio.fixture
async def collection(db_session: AsyncSession, instructor: User, ta: User) -> Collection:
    col = Collection(
        id=uuid.uuid4(),
        name="Sync Visibility",
        local_folder_name=f"sync-vis-{uuid.uuid4().hex[:6]}",
        owner_id=instructor.id,
    )
    db_session.add(col)
    await db_session.flush()
    db_session.add(
        CollectionAccess(
            collection_id=col.id, user_id=ta.id, access_role=CollectionRole.ta
        )
    )
    await db_session.flush()
    return col


@pytest_asyncio.fixture
async def repo(db_session: AsyncSession, collection: Collection) -> Repo:
    r = Repo(
        id=uuid.uuid4(),
        collection_id=collection.id,
        github_url="https://github.com/test/sync-vis",
        name="sync-vis-repo",
        local_path="/tmp/sync-vis-repo",
        health_status="unknown",
    )
    db_session.add(r)
    await db_session.flush()
    return r


@pytest.fixture
def no_background_work(monkeypatch: pytest.MonkeyPatch) -> None:
    """Keep the endpoint's own bookkeeping in frame, without a real clone."""

    async def _noop(*_args, **_kwargs) -> None:
        return None

    monkeypatch.setattr(repos_routes, "_fetch_and_recompute", _noop)


@pytest.mark.asyncio
async def test_a_repo_starts_out_idle(
    test_client: AsyncClient, repo: Repo, instructor_headers: dict
) -> None:
    resp = await test_client.get(f"/api/v1/repos/{repo.id}", headers=instructor_headers)

    assert resp.status_code == 200
    assert resp.json()["sync_status"] == "idle"


@pytest.mark.asyncio
async def test_a_ta_sync_is_visible_to_the_instructor(
    test_client: AsyncClient,
    repo: Repo,
    ta_headers: dict,
    instructor_headers: dict,
    no_background_work: None,
) -> None:
    """The whole point: a TA starts it, the instructor can see it running."""
    start = await test_client.post(f"/api/v1/repos/{repo.id}/sync", headers=ta_headers)
    assert start.status_code == 202

    seen = await test_client.get(f"/api/v1/repos/{repo.id}", headers=instructor_headers)
    assert seen.status_code == 200
    body = seen.json()

    assert body["sync_status"] == "syncing"
    assert body["sync_started_by_name"] == "Tina TA"
    assert body["sync_started_at"] is not None


@pytest.mark.asyncio
async def test_the_collection_listing_shows_it_too(
    test_client: AsyncClient,
    collection: Collection,
    repo: Repo,
    ta_headers: dict,
    instructor_headers: dict,
    no_background_work: None,
) -> None:
    """The dashboard reads the list endpoint, so it has to carry the state."""
    await test_client.post(f"/api/v1/repos/{repo.id}/sync", headers=ta_headers)

    listing = await test_client.get(
        f"/api/v1/collections/{collection.id}/repos", headers=instructor_headers
    )
    assert listing.status_code == 200
    row = next(r for r in listing.json()["items"] if r["id"] == str(repo.id))

    assert row["sync_status"] == "syncing"
    assert row["sync_started_by_name"] == "Tina TA"


@pytest.mark.asyncio
async def test_a_finished_sync_reports_idle_again(
    test_client: AsyncClient,
    db_session: AsyncSession,
    repo: Repo,
    instructor_headers: dict,
) -> None:
    repo.sync_status = "syncing"
    repo.sync_started_at = datetime.now(timezone.utc)
    await db_session.flush()

    await repos_routes._finish_sync(db_session, repo, error=None)
    await db_session.flush()

    resp = await test_client.get(f"/api/v1/repos/{repo.id}", headers=instructor_headers)
    assert resp.json()["sync_status"] == "idle"


@pytest.mark.asyncio
async def test_a_failed_sync_surfaces_the_reason(
    test_client: AsyncClient,
    db_session: AsyncSession,
    repo: Repo,
    instructor_headers: dict,
) -> None:
    repo.sync_status = "syncing"
    repo.sync_started_at = datetime.now(timezone.utc)
    await db_session.flush()

    await repos_routes._finish_sync(db_session, repo, error="authentication failed")
    await db_session.flush()

    body = (
        await test_client.get(f"/api/v1/repos/{repo.id}", headers=instructor_headers)
    ).json()
    assert body["sync_status"] == "failed"
    assert "authentication failed" in body["sync_error"]


@pytest.mark.asyncio
async def test_an_abandoned_sync_does_not_spin_forever(
    test_client: AsyncClient,
    db_session: AsyncSession,
    repo: Repo,
    instructor_headers: dict,
) -> None:
    """A worker that dies mid-clone must not leave the repo pinned to 'syncing'.

    Nothing would ever clear the flag, so the dashboard would show a spinner
    that outlives the process. Reads treat a long-running sync as idle.
    """
    repo.sync_status = "syncing"
    repo.sync_started_at = datetime.now(timezone.utc) - timedelta(
        seconds=repos_routes.SYNC_STALE_AFTER_SECONDS + 60
    )
    await db_session.flush()

    resp = await test_client.get(f"/api/v1/repos/{repo.id}", headers=instructor_headers)
    assert resp.json()["sync_status"] == "idle"


@pytest.mark.asyncio
async def test_sync_without_a_token_leaves_the_repo_idle(
    test_client: AsyncClient,
    repo: Repo,
    instructor_headers: dict,
) -> None:
    """The instructor here has no GitHub token, so nothing should be marked."""
    resp = await test_client.post(
        f"/api/v1/repos/{repo.id}/sync", headers=instructor_headers
    )
    assert resp.status_code == 403

    seen = await test_client.get(f"/api/v1/repos/{repo.id}", headers=instructor_headers)
    assert seen.json()["sync_status"] == "idle"
