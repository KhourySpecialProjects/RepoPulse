"""Tests for GET /api/v1/collections/{collection_id}/commit-activity."""
from __future__ import annotations

import uuid
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
    """Repos with no local_path are skipped; result is empty activity list."""
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
    """If parse_commits raises an exception, that repo is skipped silently."""
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
