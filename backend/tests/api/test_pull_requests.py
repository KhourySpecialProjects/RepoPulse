"""Tests for the pull requests endpoints."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone, timedelta
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.collection import Collection
from app.models.pull_request import PullRequest
from app.models.repo import Repo
from app.models.user import User


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _make_collection(db: AsyncSession, owner_id: uuid.UUID) -> Collection:
    col = Collection(
        id=uuid.uuid4(),
        name="Test Collection",
        local_folder_name="test-col-pr",
        owner_id=owner_id,
    )
    db.add(col)
    await db.flush()
    return col


async def _make_repo(db: AsyncSession, collection_id: uuid.UUID, name: str = "test-repo") -> Repo:
    repo = Repo(
        id=uuid.uuid4(),
        collection_id=collection_id,
        github_url=f"https://github.com/test/{name}",
        name=name,
        local_path=f"/fake/{name}",
    )
    db.add(repo)
    await db.flush()
    return repo


async def _make_pr(
    db: AsyncSession,
    repo_id: uuid.UUID,
    pr_number: int = 1,
    state: str = "open",
    author_login: str = "alice",
    created_at: datetime | None = None,
    merged_at: datetime | None = None,
) -> PullRequest:
    now = datetime.now(timezone.utc)
    pr = PullRequest(
        id=uuid.uuid4(),
        repo_id=repo_id,
        pr_number=pr_number,
        title=f"PR #{pr_number}",
        state=state,
        author_login=author_login,
        created_at=created_at or now,
        merged_at=merged_at,
        html_url=f"https://github.com/test/repo/pull/{pr_number}",
        fetched_at=now,
    )
    db.add(pr)
    await db.flush()
    return pr


# ---------------------------------------------------------------------------
# POST /repos/{repo_id}/pull-requests/sync
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_sync_prs_404_unknown_repo(
    test_client: AsyncClient,
    auth_headers: dict,
) -> None:
    """Returns 404 for a repo that does not exist."""
    resp = await test_client.post(
        f"/api/v1/repos/{uuid.uuid4()}/pull-requests/sync",
        headers=auth_headers,
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_sync_prs_403_no_github_token(
    test_client: AsyncClient,
    db_session: AsyncSession,
    test_user: User,
    auth_headers: dict,
) -> None:
    """Returns 403 when the current user has no github_token."""
    # Ensure test_user has no github_token
    test_user.github_token = None
    await db_session.flush()

    col = await _make_collection(db_session, test_user.id)
    repo = await _make_repo(db_session, col.id)

    resp = await test_client.post(
        f"/api/v1/repos/{repo.id}/pull-requests/sync",
        headers=auth_headers,
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_sync_prs_success(
    test_client: AsyncClient,
    db_session: AsyncSession,
    test_user: User,
    auth_headers: dict,
) -> None:
    """Syncs PRs successfully and returns synced count."""
    test_user.github_token = "ghp_test_token"
    await db_session.flush()

    col = await _make_collection(db_session, test_user.id)
    repo = await _make_repo(db_session, col.id)

    raw_prs = [
        {
            "number": 1,
            "title": "Add feature X",
            "state": "open",
            "user": {"login": "alice"},
            "created_at": "2026-01-01T10:00:00Z",
            "merged_at": None,
            "closed_at": None,
            "html_url": "https://github.com/test/repo/pull/1",
            "requested_reviewers": [],
            "draft": False,
        },
        {
            "number": 2,
            "title": "Fix bug Y",
            "state": "closed",
            "user": {"login": "bob"},
            "created_at": "2026-01-02T10:00:00Z",
            "merged_at": "2026-01-03T10:00:00Z",
            "closed_at": "2026-01-03T10:00:00Z",
            "html_url": "https://github.com/test/repo/pull/2",
            "requested_reviewers": [{"login": "carol"}],
            "draft": False,
        },
    ]

    with patch(
        "app.api.routes.pull_requests.GitHubService.fetch_pull_requests",
        new_callable=AsyncMock,
        return_value=raw_prs,
    ):
        resp = await test_client.post(
            f"/api/v1/repos/{repo.id}/pull-requests/sync",
            headers=auth_headers,
        )

    assert resp.status_code == 200
    data = resp.json()
    assert data["synced"] == 2
    assert data["repo_id"] == str(repo.id)
    assert "fetched_at" in data


@pytest.mark.asyncio
async def test_sync_prs_upserts_on_conflict(
    test_client: AsyncClient,
    db_session: AsyncSession,
    test_user: User,
    auth_headers: dict,
) -> None:
    """Upserting the same PR twice updates it rather than duplicating."""
    test_user.github_token = "ghp_test_token"
    await db_session.flush()

    col = await _make_collection(db_session, test_user.id)
    repo = await _make_repo(db_session, col.id)

    # Pre-seed PR #1 as open
    await _make_pr(db_session, repo.id, pr_number=1, state="open")

    raw_prs = [
        {
            "number": 1,
            "title": "Updated title",
            "state": "closed",
            "user": {"login": "alice"},
            "created_at": "2026-01-01T10:00:00Z",
            "merged_at": "2026-01-05T10:00:00Z",
            "closed_at": "2026-01-05T10:00:00Z",
            "html_url": "https://github.com/test/repo/pull/1",
            "requested_reviewers": [],
            "draft": False,
        },
    ]

    with patch(
        "app.api.routes.pull_requests.GitHubService.fetch_pull_requests",
        new_callable=AsyncMock,
        return_value=raw_prs,
    ):
        resp = await test_client.post(
            f"/api/v1/repos/{repo.id}/pull-requests/sync",
            headers=auth_headers,
        )

    assert resp.status_code == 200
    assert resp.json()["synced"] == 1


@pytest.mark.asyncio
async def test_sync_prs_502_on_github_error(
    test_client: AsyncClient,
    db_session: AsyncSession,
    test_user: User,
    auth_headers: dict,
) -> None:
    """Returns 502 when the GitHub API call fails."""
    import httpx

    test_user.github_token = "ghp_test_token"
    await db_session.flush()

    col = await _make_collection(db_session, test_user.id)
    repo = await _make_repo(db_session, col.id)

    with patch(
        "app.api.routes.pull_requests.GitHubService.fetch_pull_requests",
        new_callable=AsyncMock,
        side_effect=httpx.HTTPStatusError(
            "403 Forbidden",
            request=httpx.Request("GET", "https://api.github.com"),
            response=httpx.Response(403),
        ),
    ):
        resp = await test_client.post(
            f"/api/v1/repos/{repo.id}/pull-requests/sync",
            headers=auth_headers,
        )

    assert resp.status_code == 502


# ---------------------------------------------------------------------------
# GET /repos/{repo_id}/pull-requests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_prs_empty(
    test_client: AsyncClient,
    db_session: AsyncSession,
    test_user: User,
    auth_headers: dict,
) -> None:
    """Returns an empty list when no PRs exist for the repo."""
    col = await _make_collection(db_session, test_user.id)
    repo = await _make_repo(db_session, col.id)

    resp = await test_client.get(
        f"/api/v1/repos/{repo.id}/pull-requests",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["items"] == []
    assert data["total"] == 0
    assert data["limit"] == 100
    assert data["offset"] == 0
    assert data["fetched_at"] is None


@pytest.mark.asyncio
async def test_list_prs_returns_all(
    test_client: AsyncClient,
    db_session: AsyncSession,
    test_user: User,
    auth_headers: dict,
) -> None:
    """Returns all PRs for the repo ordered by created_at DESC."""
    col = await _make_collection(db_session, test_user.id)
    repo = await _make_repo(db_session, col.id)

    now = datetime.now(timezone.utc)
    await _make_pr(db_session, repo.id, pr_number=1, state="open", created_at=now - timedelta(days=2))
    await _make_pr(db_session, repo.id, pr_number=2, state="merged", created_at=now - timedelta(days=1))
    await _make_pr(db_session, repo.id, pr_number=3, state="closed", created_at=now)

    resp = await test_client.get(
        f"/api/v1/repos/{repo.id}/pull-requests",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 3
    # First item should be newest (pr_number=3)
    assert data["items"][0]["pr_number"] == 3
    assert data["items"][2]["pr_number"] == 1
    assert data["fetched_at"] is not None


@pytest.mark.asyncio
async def test_list_prs_state_filter(
    test_client: AsyncClient,
    db_session: AsyncSession,
    test_user: User,
    auth_headers: dict,
) -> None:
    """Filters PRs by state when the state query param is provided."""
    col = await _make_collection(db_session, test_user.id)
    repo = await _make_repo(db_session, col.id)

    await _make_pr(db_session, repo.id, pr_number=1, state="open")
    await _make_pr(db_session, repo.id, pr_number=2, state="merged")
    await _make_pr(db_session, repo.id, pr_number=3, state="open")

    resp = await test_client.get(
        f"/api/v1/repos/{repo.id}/pull-requests?state=open",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 2
    assert all(item["state"] == "open" for item in data["items"])


@pytest.mark.asyncio
async def test_list_prs_pagination(
    test_client: AsyncClient,
    db_session: AsyncSession,
    test_user: User,
    auth_headers: dict,
) -> None:
    """Supports limit/offset pagination."""
    col = await _make_collection(db_session, test_user.id)
    repo = await _make_repo(db_session, col.id)

    now = datetime.now(timezone.utc)
    for i in range(5):
        await _make_pr(db_session, repo.id, pr_number=i + 1, created_at=now - timedelta(days=5 - i))

    resp = await test_client.get(
        f"/api/v1/repos/{repo.id}/pull-requests?limit=2&offset=1",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["items"]) == 2
    assert data["total"] == 5
    assert data["limit"] == 2
    assert data["offset"] == 1


@pytest.mark.asyncio
async def test_list_prs_404_unknown_repo(
    test_client: AsyncClient,
    auth_headers: dict,
) -> None:
    """Returns 404 for a repo that does not exist."""
    resp = await test_client.get(
        f"/api/v1/repos/{uuid.uuid4()}/pull-requests",
        headers=auth_headers,
    )
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# GET /repos/{repo_id}/pull-requests/stats
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_pr_stats_empty(
    test_client: AsyncClient,
    db_session: AsyncSession,
    test_user: User,
    auth_headers: dict,
) -> None:
    """Returns zeroed stats when no PRs exist."""
    col = await _make_collection(db_session, test_user.id)
    repo = await _make_repo(db_session, col.id)

    resp = await test_client.get(
        f"/api/v1/repos/{repo.id}/pull-requests/stats",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["open_count"] == 0
    assert data["merged_last_30d"] == 0
    assert data["avg_days_to_merge"] is None
    assert data["total_count"] == 0
    assert data["fetched_at"] is None


@pytest.mark.asyncio
async def test_pr_stats_counts(
    test_client: AsyncClient,
    db_session: AsyncSession,
    test_user: User,
    auth_headers: dict,
) -> None:
    """Returns correct counts for open, merged_last_30d, and total."""
    col = await _make_collection(db_session, test_user.id)
    repo = await _make_repo(db_session, col.id)

    now = datetime.now(timezone.utc)

    # 2 open PRs
    await _make_pr(db_session, repo.id, pr_number=1, state="open")
    await _make_pr(db_session, repo.id, pr_number=2, state="open")

    # 1 merged within 30 days
    await _make_pr(
        db_session, repo.id, pr_number=3, state="merged",
        created_at=now - timedelta(days=10),
        merged_at=now - timedelta(days=5),
    )

    # 1 merged more than 30 days ago (should NOT appear in merged_last_30d)
    await _make_pr(
        db_session, repo.id, pr_number=4, state="merged",
        created_at=now - timedelta(days=60),
        merged_at=now - timedelta(days=45),
    )

    resp = await test_client.get(
        f"/api/v1/repos/{repo.id}/pull-requests/stats",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["open_count"] == 2
    assert data["merged_last_30d"] == 1
    assert data["total_count"] == 4
    assert data["avg_days_to_merge"] is not None
    assert data["avg_days_to_merge"] > 0


@pytest.mark.asyncio
async def test_pr_stats_404_unknown_repo(
    test_client: AsyncClient,
    auth_headers: dict,
) -> None:
    """Returns 404 for a repo that does not exist."""
    resp = await test_client.get(
        f"/api/v1/repos/{uuid.uuid4()}/pull-requests/stats",
        headers=auth_headers,
    )
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# GitHubService unit tests
# ---------------------------------------------------------------------------


def test_parse_github_url_plain() -> None:
    from app.services.github_service import GitHubService

    svc = GitHubService()
    owner, repo = svc._parse_github_url("https://github.com/octocat/Hello-World")
    assert owner == "octocat"
    assert repo == "Hello-World"


def test_parse_github_url_with_git_suffix() -> None:
    from app.services.github_service import GitHubService

    svc = GitHubService()
    owner, repo = svc._parse_github_url("https://github.com/octocat/Hello-World.git")
    assert owner == "octocat"
    assert repo == "Hello-World"


def test_parse_pr_open() -> None:
    from app.services.github_service import GitHubService

    svc = GitHubService()
    raw = {
        "number": 42,
        "title": "My PR",
        "state": "open",
        "user": {"login": "alice"},
        "created_at": "2026-01-01T10:00:00Z",
        "merged_at": None,
        "closed_at": None,
        "html_url": "https://github.com/test/repo/pull/42",
        "requested_reviewers": [],
        "draft": False,
    }
    result = svc.parse_pr(raw)
    assert result["pr_number"] == 42
    assert result["state"] == "open"
    assert result["author_login"] == "alice"
    assert result["merged_at"] is None
    assert result["draft"] is False
    assert result["reviews_requested"] == 0


def test_parse_pr_merged() -> None:
    from app.services.github_service import GitHubService

    svc = GitHubService()
    raw = {
        "number": 7,
        "title": "Merged PR",
        "state": "closed",
        "user": {"login": "bob"},
        "created_at": "2026-01-02T10:00:00Z",
        "merged_at": "2026-01-05T12:00:00Z",
        "closed_at": "2026-01-05T12:00:00Z",
        "html_url": "https://github.com/test/repo/pull/7",
        "requested_reviewers": [{"login": "carol"}, {"login": "dave"}],
        "draft": False,
    }
    result = svc.parse_pr(raw)
    assert result["state"] == "merged"  # overridden from "closed"
    assert result["reviews_requested"] == 2
    assert result["merged_at"] is not None
