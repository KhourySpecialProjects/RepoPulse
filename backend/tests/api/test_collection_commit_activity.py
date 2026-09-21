"""Tests for GET /api/v1/collections/{collection_id}/commit-activity."""
from __future__ import annotations

import uuid
from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.collection import Collection
from app.models.repo import Repo


FAKE_COMMITS = [
    {
        "hash": "abc001",
        "author_name": "Alice",
        "author_email": "alice@example.com",
        "date": "2025-01-01T10:00:00",
        "message": "First commit",
        "branch": "main",
        "insertions": 10,
        "deletions": 0,
        "files_changed": 1,
    },
    {
        "hash": "abc002",
        "author_name": "Bob",
        "author_email": "bob@example.com",
        "date": "2025-01-01T14:00:00",
        "message": "Second commit",
        "branch": "main",
        "insertions": 5,
        "deletions": 2,
        "files_changed": 1,
    },
    {
        "hash": "abc003",
        "author_name": "Alice",
        "author_email": "alice@example.com",
        "date": "2025-01-03T09:00:00",
        "message": "Third commit",
        "branch": "feature",
        "insertions": 20,
        "deletions": 5,
        "files_changed": 3,
    },
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

    duplicate_commit = {
        "hash": "shared-hash-xyz",
        "author_name": "Dev",
        "author_email": "dev@example.com",
        "date": "2025-02-10T08:00:00",
        "message": "Shared commit",
        "branch": "main",
        "insertions": 1,
        "deletions": 0,
        "files_changed": 1,
    }

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


# ── Snapshot fallback ────────────────────────────────────────────────────────
#
# The dashboard graph and the collection chart both read this endpoint, and it
# was the only commit reader still going straight to the clone with no fallback:
# `get_repo_commits` and `collect_activity` already drop back to the last synced
# snapshot. On any machine that never did the clone — a fresh container, a
# recreated bind mount, a seeded database — that made the graph read flat zero
# while the commits table beside it showed history.


async def _snapshot(db_session: AsyncSession, repo_id: uuid.UUID) -> None:
    from app.services import commit_snapshot_service

    await commit_snapshot_service.store(
        db_session,
        repo_id,
        [
            {**commit, "date": datetime.fromisoformat(commit["date"]), "branches": [commit["branch"]], "origin_branch": commit["branch"]}
            for commit in FAKE_COMMITS
        ],
    )
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
async def test_commit_activity_falls_back_to_snapshot_when_the_clone_is_unreadable(
    test_client: AsyncClient,
    auth_headers: dict,
    db_session: AsyncSession,
    test_user,
) -> None:
    coll_id = await _collection(test_client, auth_headers, "fallback")

    repo = Repo(
        id=uuid.uuid4(),
        collection_id=uuid.UUID(coll_id),
        github_url="https://github.com/test/unreadable",
        name="unreadable",
        local_path="/nonexistent/clone",
        health_status="unknown",
    )
    db_session.add(repo)
    await db_session.flush()
    await _snapshot(db_session, repo.id)

    with patch(
        "app.api.routes.collections._git_service.parse_commits",
        new=AsyncMock(side_effect=Exception("not a git repository")),
    ):
        resp = await test_client.get(
            f"/api/v1/collections/{coll_id}/commit-activity",
            headers=auth_headers,
        )

    assert resp.status_code == 200
    # Same aggregation as a live clone: 2 commits on the 1st, 1 on the 3rd.
    assert resp.json()["activity"] == [
        {"date": "2025-01-01", "count": 2},
        {"date": "2025-01-03", "count": 1},
    ]


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
async def test_commit_activity_prefers_the_live_clone_over_the_snapshot(
    test_client: AsyncClient,
    auth_headers: dict,
    db_session: AsyncSession,
    test_user,
) -> None:
    """The clone stays the source of truth; the snapshot is only a fallback."""
    coll_id = await _collection(test_client, auth_headers, "prefers-live")

    repo = Repo(
        id=uuid.uuid4(),
        collection_id=uuid.UUID(coll_id),
        github_url="https://github.com/test/live",
        name="live",
        local_path="/repos/live",
        health_status="unknown",
    )
    db_session.add(repo)
    await db_session.flush()
    await _snapshot(db_session, repo.id)

    live = [dict(FAKE_COMMITS[0], hash="live001", date="2025-06-09T10:00:00")]
    with patch(
        "app.api.routes.collections._git_service.parse_commits",
        new=AsyncMock(return_value=live),
    ):
        resp = await test_client.get(
            f"/api/v1/collections/{coll_id}/commit-activity",
            headers=auth_headers,
        )

    assert resp.status_code == 200
    # Only the clone's commit — the snapshot's three are not mixed in.
    assert resp.json()["activity"] == [{"date": "2025-06-09", "count": 1}]


@pytest.mark.asyncio
async def test_commit_activity_still_dedupes_across_the_fallback(
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
