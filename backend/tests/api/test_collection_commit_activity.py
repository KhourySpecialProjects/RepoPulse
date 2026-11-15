"""Tests for GET /api/v1/collections/{collection_id}/commit-activity."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.collection import Collection
from app.models.repo import Repo


def _parsed(sha: str, author: str, when: str, branch: str = "main") -> dict:
    """One entry shaped like GitService.parse_commits output."""
    return {
        "hash": sha,
        "author_name": author,
        "author_email": f"{author.lower()}@example.com",
        "date": datetime.fromisoformat(when).replace(tzinfo=timezone.utc),
        "message": f"commit {sha}",
        "branches": [branch],
        "origin_branch": branch,
        "insertions": 10,
        "deletions": 1,
        "files_changed": 1,
    }


FAKE_COMMITS = [
    _parsed("abc001", "Alice", "2025-01-01T10:00:00"),
    _parsed("abc002", "Bob", "2025-01-01T14:00:00"),
    _parsed("abc003", "Alice", "2025-01-03T09:00:00", branch="feature"),
]


@pytest.mark.asyncio
async def test_commit_activity_returns_aggregated_daily_counts(
    test_client: AsyncClient,
    auth_headers: dict,
    db_session: AsyncSession,
    test_user,
) -> None:
    """Returns activity list with deduplicated daily commit counts."""
    # Create a collection
    resp = await test_client.post(
        "/api/v1/collections",
        headers=auth_headers,
        json={"name": "Activity Coll", "local_folder_name": f"act-{uuid.uuid4().hex[:6]}"},
    )
    assert resp.status_code == 201
    coll_id = resp.json()["id"]

    # Insert a repo with a local_path
    repo = Repo(
        id=uuid.uuid4(),
        collection_id=uuid.UUID(coll_id),
        github_url="https://github.com/test/act-repo",
        name="act-repo",
        local_path="/tmp/fake-act-repo",
        health_status="unknown",
    )
    db_session.add(repo)
    await db_session.flush()

    with patch(
        "app.api.routes.collections._git_service.parse_commits",
        new=AsyncMock(return_value=FAKE_COMMITS),
    ):
        activity_resp = await test_client.get(
            f"/api/v1/collections/{coll_id}/commit-activity",
            headers=auth_headers,
        )

    assert activity_resp.status_code == 200
    data = activity_resp.json()
    assert "activity" in data

    activity = data["activity"]
    # Should have two dates: 2025-01-01 (2 commits) and 2025-01-03 (1 commit)
    assert len(activity) == 2

    by_date = {item["date"]: item["count"] for item in activity}
    assert by_date["2025-01-01"] == 2
    assert by_date["2025-01-03"] == 1

    # Verify ascending sort by date
    dates = [item["date"] for item in activity]
    assert dates == sorted(dates)


@pytest.mark.asyncio
async def test_commit_activity_deduplicates_by_hash(
    test_client: AsyncClient,
    auth_headers: dict,
    db_session: AsyncSession,
    test_user,
) -> None:
    """Same commit hash from two repos is only counted once."""
    resp = await test_client.post(
        "/api/v1/collections",
        headers=auth_headers,
        json={"name": "Dedup Coll", "local_folder_name": f"dedup-{uuid.uuid4().hex[:6]}"},
    )
    assert resp.status_code == 201
    coll_id = resp.json()["id"]

    # Two repos, both returning the same commit hash
    repo1 = Repo(
        id=uuid.uuid4(),
        collection_id=uuid.UUID(coll_id),
        github_url="https://github.com/test/dedup-repo1",
        name="dedup-repo1",
        local_path="/tmp/fake-dedup-repo1",
        health_status="unknown",
    )
    repo2 = Repo(
        id=uuid.uuid4(),
        collection_id=uuid.UUID(coll_id),
        github_url="https://github.com/test/dedup-repo2",
        name="dedup-repo2",
        local_path="/tmp/fake-dedup-repo2",
        health_status="unknown",
    )
    db_session.add_all([repo1, repo2])
    await db_session.flush()

    duplicate_commit = _parsed("shared-hash-xyz", "Dev", "2025-02-10T08:00:00")

    with patch(
        "app.api.routes.collections._git_service.parse_commits",
        new=AsyncMock(return_value=[duplicate_commit]),
    ):
        activity_resp = await test_client.get(
            f"/api/v1/collections/{coll_id}/commit-activity",
            headers=auth_headers,
        )

    assert activity_resp.status_code == 200
    activity = activity_resp.json()["activity"]
    assert len(activity) == 1
    assert activity[0]["date"] == "2025-02-10"
    assert activity[0]["count"] == 1  # Not 2, because hash was deduplicated


@pytest.mark.asyncio
async def test_commit_activity_skips_repos_without_local_path(
    test_client: AsyncClient,
    auth_headers: dict,
    db_session: AsyncSession,
    test_user,
) -> None:
    """A repo with no clone and no snapshot contributes nothing."""
    resp = await test_client.post(
        "/api/v1/collections",
        headers=auth_headers,
        json={"name": "No Path Coll", "local_folder_name": f"nopath-{uuid.uuid4().hex[:6]}"},
    )
    assert resp.status_code == 201
    coll_id = resp.json()["id"]

    # Repo with no local_path (clone not done yet)
    repo = Repo(
        id=uuid.uuid4(),
        collection_id=uuid.UUID(coll_id),
        github_url="https://github.com/test/no-path-repo",
        name="no-path-repo",
        local_path=None,
        health_status="unknown",
    )
    db_session.add(repo)
    await db_session.flush()

    activity_resp = await test_client.get(
        f"/api/v1/collections/{coll_id}/commit-activity",
        headers=auth_headers,
    )

    assert activity_resp.status_code == 200
    assert activity_resp.json()["activity"] == []


@pytest.mark.asyncio
async def test_commit_activity_silently_skips_broken_git_repo(
    test_client: AsyncClient,
    auth_headers: dict,
    db_session: AsyncSession,
    test_user,
) -> None:
    """A broken clone with no snapshot behind it contributes nothing."""
    resp = await test_client.post(
        "/api/v1/collections",
        headers=auth_headers,
        json={"name": "Broken Git Coll", "local_folder_name": f"broken-{uuid.uuid4().hex[:6]}"},
    )
    assert resp.status_code == 201
    coll_id = resp.json()["id"]

    repo = Repo(
        id=uuid.uuid4(),
        collection_id=uuid.UUID(coll_id),
        github_url="https://github.com/test/broken-repo",
        name="broken-repo",
        local_path="/tmp/fake-broken-repo",
        health_status="unknown",
    )
    db_session.add(repo)
    await db_session.flush()

    with patch(
        "app.api.routes.collections._git_service.parse_commits",
        new=AsyncMock(side_effect=Exception("git repo is corrupt")),
    ):
        activity_resp = await test_client.get(
            f"/api/v1/collections/{coll_id}/commit-activity",
            headers=auth_headers,
        )

    assert activity_resp.status_code == 200
    assert activity_resp.json()["activity"] == []


@pytest.mark.asyncio
async def test_commit_activity_returns_empty_for_collection_with_no_repos(
    test_client: AsyncClient,
    auth_headers: dict,
) -> None:
    """Collection with no repos returns empty activity list."""
    resp = await test_client.post(
        "/api/v1/collections",
        headers=auth_headers,
        json={"name": "Empty Coll", "local_folder_name": f"empty-{uuid.uuid4().hex[:6]}"},
    )
    assert resp.status_code == 201
    coll_id = resp.json()["id"]

    activity_resp = await test_client.get(
        f"/api/v1/collections/{coll_id}/commit-activity",
        headers=auth_headers,
    )
    assert activity_resp.status_code == 200
    assert activity_resp.json()["activity"] == []


@pytest.mark.asyncio
async def test_commit_activity_returns_404_for_nonexistent_collection(
    test_client: AsyncClient,
    auth_headers: dict,
) -> None:
    """Non-existent collection ID returns 404."""
    fake_id = uuid.uuid4()
    activity_resp = await test_client.get(
        f"/api/v1/collections/{fake_id}/commit-activity",
        headers=auth_headers,
    )
    assert activity_resp.status_code == 404


@pytest.mark.asyncio
async def test_commit_activity_requires_auth(
    test_client: AsyncClient,
) -> None:
    """Request without auth token returns 401 or 403."""
    fake_id = uuid.uuid4()
    activity_resp = await test_client.get(
        f"/api/v1/collections/{fake_id}/commit-activity",
    )
    assert activity_resp.status_code in (401, 403)

@pytest.mark.asyncio
async def test_contextual_activity_authorized_collection(test_client, auth_headers, db_session, test_user):
    collection = Collection(id=uuid.uuid4(), name='Context', local_folder_name=f'context-{uuid.uuid4().hex[:6]}', owner_id=test_user.id)
    db_session.add(collection)
    await db_session.flush()
    collection_id = collection.id
    result = await test_client.get(f'/api/v1/collections/{collection_id}/contextual-activity', headers=auth_headers)
    assert result.status_code == 200
    assert result.json() == {'repositories': []}
    repo = Repo(id=uuid.uuid4(), collection_id=collection.id, name='Context repo', github_url='https://github.com/test/context', local_path='/tmp/context')
    db_session.add(repo)
    await db_session.flush()
    with patch('app.api.routes.collections._git_service.parse_commits', new=AsyncMock(return_value=FAKE_COMMITS)):
        populated = await test_client.get(f'/api/v1/collections/{collection_id}/contextual-activity', headers=auth_headers)
    assert populated.status_code == 200
    assert populated.json()['repositories'][0]['activity'][0]['count'] == 2
    with patch('app.api.routes.collections.can_access_collection', new=AsyncMock(return_value=False)):
        denied = await test_client.get(f'/api/v1/collections/{collection_id}/contextual-activity', headers=auth_headers)
    assert denied.status_code == 404
    missing = await test_client.get(f'/api/v1/collections/{uuid.uuid4()}/contextual-activity', headers=auth_headers)
    assert missing.status_code == 404
    anonymous = await test_client.get(f'/api/v1/collections/{collection_id}/contextual-activity')
    assert anonymous.status_code in (401, 403)


# ── Reading the stored history ───────────────────────────────────────────────
#
# Sync stores what it parsed in the `commits` table, and this endpoint reads
# that instead of re-parsing every clone in the collection on each load — which
# took 30s+ on real collections. A repo with nothing stored is parsed once.


async def _snapshot(db_session: AsyncSession, repo_id: uuid.UUID) -> None:
    from app.services import commit_snapshot_service

    await commit_snapshot_service.store(db_session, repo_id, FAKE_COMMITS)
    await db_session.flush()


async def _collection(test_client: AsyncClient, auth_headers: dict, label: str) -> str:
    resp = await test_client.post(
        "/api/v1/collections",
        headers=auth_headers,
        json={"name": label, "local_folder_name": f"{label}-{uuid.uuid4().hex[:6]}"},
    )
    assert resp.status_code == 201
    return resp.json()["id"]


@pytest.mark.asyncio
async def test_commit_activity_reads_stored_history_without_parsing_the_clone(
    test_client: AsyncClient,
    auth_headers: dict,
    db_session: AsyncSession,
    test_user,
) -> None:
    coll_id = await _collection(test_client, auth_headers, "stored")

    repo = Repo(
        id=uuid.uuid4(),
        collection_id=uuid.UUID(coll_id),
        github_url="https://github.com/test/stored",
        name="stored",
        local_path="/repos/stored",
        health_status="unknown",
    )
    db_session.add(repo)
    await db_session.flush()
    await _snapshot(db_session, repo.id)

    parse = AsyncMock(side_effect=AssertionError("stored history must not be re-parsed"))
    with patch("app.api.routes.collections._git_service.parse_commits", new=parse):
        resp = await test_client.get(
            f"/api/v1/collections/{coll_id}/commit-activity",
            headers=auth_headers,
        )

    assert resp.status_code == 200
    assert resp.json()["activity"] == [
        {"date": "2025-01-01", "count": 2},
        {"date": "2025-01-03", "count": 1},
    ]
    parse.assert_not_awaited()


@pytest.mark.asyncio
async def test_commit_activity_uses_the_snapshot_when_there_is_no_clone_path(
    test_client: AsyncClient,
    auth_headers: dict,
    db_session: AsyncSession,
    test_user,
) -> None:
    """A pathless repo must not be filtered out of the query, or its snapshot
    can never be reached."""
    coll_id = await _collection(test_client, auth_headers, "pathless")

    repo = Repo(
        id=uuid.uuid4(),
        collection_id=uuid.UUID(coll_id),
        github_url="https://github.com/test/pathless",
        name="pathless",
        local_path=None,
        health_status="unknown",
    )
    db_session.add(repo)
    await db_session.flush()
    await _snapshot(db_session, repo.id)

    resp = await test_client.get(
        f"/api/v1/collections/{coll_id}/commit-activity",
        headers=auth_headers,
    )

    assert resp.status_code == 200
    assert resp.json()["activity"] == [
        {"date": "2025-01-01", "count": 2},
        {"date": "2025-01-03", "count": 1},
    ]


@pytest.mark.asyncio
async def test_commit_activity_dedupes_stored_history_across_repos(
    test_client: AsyncClient,
    auth_headers: dict,
    db_session: AsyncSession,
    test_user,
) -> None:
    """Two repos sharing a fork's history must not double-count it."""
    coll_id = await _collection(test_client, auth_headers, "dedupe-fallback")

    for name in ("fork-a", "fork-b"):
        repo = Repo(
            id=uuid.uuid4(),
            collection_id=uuid.UUID(coll_id),
            github_url=f"https://github.com/test/{name}",
            name=name,
            local_path=None,
            health_status="unknown",
        )
        db_session.add(repo)
        await db_session.flush()
        await _snapshot(db_session, repo.id)

    resp = await test_client.get(
        f"/api/v1/collections/{coll_id}/commit-activity",
        headers=auth_headers,
    )

    assert resp.status_code == 200
    assert resp.json()["activity"] == [
        {"date": "2025-01-01", "count": 2},
        {"date": "2025-01-03", "count": 1},
    ]
