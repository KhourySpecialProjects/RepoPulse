"""Tests for the commit quality endpoint."""
from __future__ import annotations

import json
import uuid
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.collection import Collection
from app.models.commit_classification import CommitClassification
from app.models.repo import Repo


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _make_collection(db: AsyncSession, owner_id: uuid.UUID) -> Collection:
    col = Collection(
        id=uuid.uuid4(),
        name="Test Collection",
        local_folder_name="test-col",
        owner_id=owner_id,
    )
    db.add(col)
    await db.flush()
    return col


async def _make_repo(
    db: AsyncSession,
    collection_id: uuid.UUID,
    name: str,
    local_path: str | None = None,
) -> Repo:
    repo = Repo(
        id=uuid.uuid4(),
        collection_id=collection_id,
        github_url=f"https://github.com/test/{name}",
        name=name,
        local_path=local_path,
    )
    db.add(repo)
    await db.flush()
    return repo


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_commit_quality_404_unknown_collection(
    test_client: AsyncClient, auth_headers: dict
) -> None:
    """Returns 404 for a collection that does not exist."""
    random_id = uuid.uuid4()
    resp = await test_client.get(
        f"/api/v1/collections/{random_id}/commit-quality",
        headers=auth_headers,
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_commit_quality_403_no_access(
    test_client: AsyncClient,
    db_session: AsyncSession,
    auth_headers: dict,
) -> None:
    """Returns 403 when the current user has no access to the collection."""
    # Create a collection owned by a different user
    other_owner_id = uuid.uuid4()
    from app.models.user import User

    other_user = User(
        id=other_owner_id,
        email="other@example.com",
        display_name="Other User",
        role="instructor",
        password_hash=None,
    )
    db_session.add(other_user)
    await db_session.flush()

    col = await _make_collection(db_session, other_owner_id)

    resp = await test_client.get(
        f"/api/v1/collections/{col.id}/commit-quality",
        headers=auth_headers,
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_commit_quality_empty_when_no_repos_cloned(
    test_client: AsyncClient,
    db_session: AsyncSession,
    test_user,
    auth_headers: dict,
) -> None:
    """Returns an empty repos list when all repos lack a local_path."""
    col = await _make_collection(db_session, test_user.id)
    await _make_repo(db_session, col.id, "repo-a", local_path=None)
    await _make_repo(db_session, col.id, "repo-b", local_path=None)

    resp = await test_client.get(
        f"/api/v1/collections/{col.id}/commit-quality",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["repos"] == []
    assert data["repos_skipped"] == 2
    assert "model_used" in data
    assert data["total_cache_hits"] == 0
    assert data["total_newly_scored"] == 0


@pytest.mark.asyncio
async def test_commit_quality_scores_commits_via_llm(
    test_client: AsyncClient,
    db_session: AsyncSession,
    test_user,
    auth_headers: dict,
) -> None:
    """Scores commits using the LLM and returns structured results."""
    col = await _make_collection(db_session, test_user.id)
    # Use a sentinel path — we mock git_service so it never hits disk
    repo = await _make_repo(db_session, col.id, "my-repo", local_path="/fake/path/my-repo")

    fake_commits = [
        {
            "hash": "abc1234",
            "full_hash": "abc1234abc1234abc1234abc1234abc1234abc12",
            "message": "Fix null pointer in auth service",
            "author": "Alice",
            "date": "2026-01-01T10:00:00",
        },
        {
            "hash": "def5678",
            "full_hash": "def5678def5678def5678def5678def5678def56",
            "message": "wip",
            "author": "Bob",
            "date": "2026-01-02T11:00:00",
        },
    ]

    # LLM returns a valid JSON array scoring both commits
    llm_response = json.dumps([{"i": 0, "s": "good"}, {"i": 1, "s": "bad"}])

    with (
        patch(
            "app.api.routes.commit_quality._git_service.get_recent_commits",
            new_callable=AsyncMock,
            return_value=fake_commits,
        ),
        patch(
            "app.services.commit_classifier_service.get_llm_service"
        ) as mock_get_llm,
    ):
        mock_llm_instance = AsyncMock()
        mock_llm_instance.generate = AsyncMock(return_value=llm_response)
        mock_get_llm.return_value = mock_llm_instance

        resp = await test_client.get(
            f"/api/v1/collections/{col.id}/commit-quality",
            headers=auth_headers,
        )

    assert resp.status_code == 200
    data = resp.json()

    assert data["repos_skipped"] == 0
    assert len(data["repos"]) == 1
    assert data["total_cache_hits"] == 0
    assert data["total_newly_scored"] == 2

    repo_result = data["repos"][0]
    assert repo_result["repo_id"] == str(repo.id)
    assert repo_result["repo_name"] == "my-repo"
    assert len(repo_result["commits"]) == 2
    assert repo_result["cache_hits"] == 0
    assert repo_result["newly_scored"] == 2

    commits = repo_result["commits"]
    assert commits[0]["hash"] == "abc1234"
    assert commits[0]["full_hash"] == "abc1234abc1234abc1234abc1234abc1234abc12"
    assert commits[0]["score"] == "good"
    assert commits[0]["from_cache"] is False
    assert commits[1]["hash"] == "def5678"
    assert commits[1]["score"] == "bad"
    assert commits[1]["from_cache"] is False


async def _classification_rows(db: AsyncSession, repo_id: uuid.UUID) -> list[CommitClassification]:
    result = await db.execute(
        select(CommitClassification).where(CommitClassification.repo_id == repo_id)
    )
    return list(result.scalars().all())


@pytest.mark.asyncio
async def test_commit_quality_returns_null_score_on_llm_error(
    test_client: AsyncClient,
    db_session: AsyncSession,
    test_user,
    auth_headers: dict,
) -> None:
    """A failed LLM call leaves the commit unscored — and writes nothing.

    This used to return "ok" for every commit and persist it. Those fabricated
    scores were indistinguishable from real ones, cached by commit hash, and
    never revisited: a single API blip permanently poisoned the cache.
    """
    col = await _make_collection(db_session, test_user.id)
    repo = await _make_repo(db_session, col.id, "error-repo", local_path="/fake/path/error-repo")

    fake_commits = [
        {
            "hash": "aaa0001",
            "full_hash": "aaa0001aaa0001aaa0001aaa0001aaa0001aaa00",
            "message": "Add feature X",
            "author": "Dev",
            "date": "2026-01-01T12:00:00",
        },
    ]

    with (
        patch(
            "app.api.routes.commit_quality._git_service.get_recent_commits",
            new_callable=AsyncMock,
            return_value=fake_commits,
        ),
        patch(
            "app.services.commit_classifier_service.get_llm_service"
        ) as mock_get_llm,
    ):
        mock_llm_instance = AsyncMock()
        mock_llm_instance.generate = AsyncMock(side_effect=RuntimeError("LLM unavailable"))
        mock_get_llm.return_value = mock_llm_instance

        resp = await test_client.get(
            f"/api/v1/collections/{col.id}/commit-quality",
            headers=auth_headers,
        )

    assert resp.status_code == 200
    data = resp.json()
    assert data["repos"][0]["commits"][0]["score"] is None
    assert data["repos"][0]["commits"][0]["from_cache"] is False
    assert data["total_newly_scored"] == 0
    # Nothing was written, so a retry can still succeed.
    assert await _classification_rows(db_session, repo.id) == []


@pytest.mark.asyncio
async def test_commit_quality_returns_null_score_on_invalid_json(
    test_client: AsyncClient,
    db_session: AsyncSession,
    test_user,
    auth_headers: dict,
) -> None:
    """An unparseable response is a failure, not an excuse to invent a score."""
    col = await _make_collection(db_session, test_user.id)
    repo = await _make_repo(db_session, col.id, "bad-json-repo", local_path="/fake/path/bad-json-repo")

    fake_commits = [
        {
            "hash": "bbb0001",
            "full_hash": "bbb0001bbb0001bbb0001bbb0001bbb0001bbb00",
            "message": "Update README",
            "author": "Dev",
            "date": "2026-01-01T12:00:00",
        },
    ]

    with (
        patch(
            "app.api.routes.commit_quality._git_service.get_recent_commits",
            new_callable=AsyncMock,
            return_value=fake_commits,
        ),
        patch(
            "app.services.commit_classifier_service.get_llm_service"
        ) as mock_get_llm,
    ):
        mock_llm_instance = AsyncMock()
        mock_llm_instance.generate = AsyncMock(return_value="not valid json at all")
        mock_get_llm.return_value = mock_llm_instance

        resp = await test_client.get(
            f"/api/v1/collections/{col.id}/commit-quality",
            headers=auth_headers,
        )

    assert resp.status_code == 200
    data = resp.json()
    assert data["repos"][0]["commits"][0]["score"] is None
    assert data["repos"][0]["commits"][0]["from_cache"] is False
    assert await _classification_rows(db_session, repo.id) == []


@pytest.mark.asyncio
async def test_commit_quality_rescoring_fills_in_a_typed_but_unscored_row(
    test_client: AsyncClient,
    db_session: AsyncSession,
    test_user,
    auth_headers: dict,
) -> None:
    """A row is no longer all-or-nothing.

    The classifier writes rows carrying a commit_type and no score. Treating
    "a row exists" as "already scored" would serve those commits a permanent
    null, and an insert that skips on conflict would never fill the gap.
    """
    col = await _make_collection(db_session, test_user.id)
    repo = await _make_repo(db_session, col.id, "typed-repo", local_path="/fake/path/typed-repo")

    full_hash = "fff0001fff0001fff0001fff0001fff0001fff00"
    db_session.add(
        CommitClassification(
            id=uuid.uuid4(),
            repo_id=repo.id,
            commit_hash=full_hash,
            score=None,
            commit_type="substantive",
            model_used="claude-sonnet-4-20250514",
        )
    )
    await db_session.flush()

    fake_commits = [{
        "hash": "fff0001",
        "full_hash": full_hash,
        "message": "Add JWT refresh token support",
        "author": "Dev",
        "date": "2026-01-01T12:00:00",
    }]

    with (
        patch(
            "app.api.routes.commit_quality._git_service.get_recent_commits",
            new_callable=AsyncMock,
            return_value=fake_commits,
        ),
        patch(
            "app.services.commit_classifier_service.get_llm_service"
        ) as mock_get_llm,
    ):
        mock_llm_instance = AsyncMock()
        mock_llm_instance.generate = AsyncMock(
            return_value=json.dumps([{"i": 0, "s": "good"}])
        )
        mock_get_llm.return_value = mock_llm_instance

        resp = await test_client.get(
            f"/api/v1/collections/{col.id}/commit-quality",
            headers=auth_headers,
        )

    assert resp.status_code == 200
    data = resp.json()
    assert data["total_newly_scored"] == 1
    assert data["repos"][0]["commits"][0]["score"] == "good"

    rows = await _classification_rows(db_session, repo.id)
    assert len(rows) == 1
    await db_session.refresh(rows[0])
    assert rows[0].score == "good"
    # The score was filled in beside the type, not instead of it.
    assert rows[0].commit_type == "substantive"


@pytest.mark.asyncio
async def test_commit_quality_per_repo_query_param(
    test_client: AsyncClient,
    db_session: AsyncSession,
    test_user,
    auth_headers: dict,
) -> None:
    """Respects the per_repo query parameter when fetching commits."""
    col = await _make_collection(db_session, test_user.id)
    await _make_repo(db_session, col.id, "param-repo", local_path="/fake/path/param-repo")

    with (
        patch(
            "app.api.routes.commit_quality._git_service.get_recent_commits",
            new_callable=AsyncMock,
            return_value=[],
        ) as mock_git,
        patch("app.services.commit_classifier_service.get_llm_service"),
    ):
        resp = await test_client.get(
            f"/api/v1/collections/{col.id}/commit-quality?per_repo=5",
            headers=auth_headers,
        )
        mock_git.assert_called_once_with("/fake/path/param-repo", limit=5)

    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_commit_quality_per_repo_out_of_range(
    test_client: AsyncClient,
    db_session: AsyncSession,
    test_user,
    auth_headers: dict,
) -> None:
    """Returns 422 for per_repo values outside the allowed range."""
    col = await _make_collection(db_session, test_user.id)

    resp = await test_client.get(
        f"/api/v1/collections/{col.id}/commit-quality?per_repo=3",
        headers=auth_headers,
    )
    assert resp.status_code == 422

    resp2 = await test_client.get(
        f"/api/v1/collections/{col.id}/commit-quality?per_repo=30",
        headers=auth_headers,
    )
    assert resp2.status_code == 422


@pytest.mark.asyncio
async def test_commit_quality_skips_repo_with_git_error(
    test_client: AsyncClient,
    db_session: AsyncSession,
    test_user,
    auth_headers: dict,
) -> None:
    """Skips repos where git raises an exception, counting them in repos_skipped."""
    col = await _make_collection(db_session, test_user.id)
    await _make_repo(db_session, col.id, "broken-repo", local_path="/nonexistent/path")

    with patch(
        "app.api.routes.commit_quality._git_service.get_recent_commits",
        new_callable=AsyncMock,
        side_effect=Exception("git error"),
    ):
        resp = await test_client.get(
            f"/api/v1/collections/{col.id}/commit-quality",
            headers=auth_headers,
        )

    assert resp.status_code == 200
    data = resp.json()
    assert data["repos"] == []
    assert data["repos_skipped"] == 1


@pytest.mark.asyncio
async def test_commit_quality_serves_from_cache(
    test_client: AsyncClient,
    db_session: AsyncSession,
    test_user,
    auth_headers: dict,
) -> None:
    """Commits with existing cache rows are served from DB; LLM is not called."""
    col = await _make_collection(db_session, test_user.id)
    repo = await _make_repo(db_session, col.id, "cached-repo", local_path="/fake/path/cached-repo")

    full_hash = "ccc0001ccc0001ccc0001ccc0001ccc0001ccc00"

    # Pre-seed a cached score
    cached_row = CommitClassification(
        id=uuid.uuid4(),
        repo_id=repo.id,
        commit_hash=full_hash,
        score="good",
        model_used="claude-sonnet-4-20250514",
    )
    db_session.add(cached_row)
    await db_session.flush()

    fake_commits = [
        {
            "hash": "ccc0001",
            "full_hash": full_hash,
            "message": "Add caching",
            "author": "Dev",
            "date": "2026-01-01T12:00:00",
        },
    ]

    with (
        patch(
            "app.api.routes.commit_quality._git_service.get_recent_commits",
            new_callable=AsyncMock,
            return_value=fake_commits,
        ),
        patch(
            "app.services.commit_classifier_service.get_llm_service"
        ) as mock_get_llm,
    ):
        resp = await test_client.get(
            f"/api/v1/collections/{col.id}/commit-quality",
            headers=auth_headers,
        )
        # LLM should not have been instantiated since all commits are cached
        mock_get_llm.assert_not_called()

    assert resp.status_code == 200
    data = resp.json()
    assert data["total_cache_hits"] == 1
    assert data["total_newly_scored"] == 0

    repo_result = data["repos"][0]
    assert repo_result["cache_hits"] == 1
    assert repo_result["newly_scored"] == 0

    commit = repo_result["commits"][0]
    assert commit["score"] == "good"
    assert commit["from_cache"] is True


@pytest.mark.asyncio
async def test_commit_quality_partial_cache(
    test_client: AsyncClient,
    db_session: AsyncSession,
    test_user,
    auth_headers: dict,
) -> None:
    """Cached commits are served from DB; only uncached commits go to the LLM."""
    col = await _make_collection(db_session, test_user.id)
    repo = await _make_repo(db_session, col.id, "partial-repo", local_path="/fake/path/partial-repo")

    cached_full_hash = "ddd0001ddd0001ddd0001ddd0001ddd0001ddd00"
    new_full_hash = "eee0002eee0002eee0002eee0002eee0002eee00"

    # Pre-seed one cached score
    cached_row = CommitClassification(
        id=uuid.uuid4(),
        repo_id=repo.id,
        commit_hash=cached_full_hash,
        score="bad",
        model_used="claude-sonnet-4-20250514",
    )
    db_session.add(cached_row)
    await db_session.flush()

    fake_commits = [
        {
            "hash": "ddd0001",
            "full_hash": cached_full_hash,
            "message": "wip",
            "author": "Dev",
            "date": "2026-01-01T12:00:00",
        },
        {
            "hash": "eee0002",
            "full_hash": new_full_hash,
            "message": "Refactor auth module for clarity",
            "author": "Dev",
            "date": "2026-01-02T12:00:00",
        },
    ]

    llm_response = json.dumps([{"i": 0, "s": "good"}])

    with (
        patch(
            "app.api.routes.commit_quality._git_service.get_recent_commits",
            new_callable=AsyncMock,
            return_value=fake_commits,
        ),
        patch(
            "app.services.commit_classifier_service.get_llm_service"
        ) as mock_get_llm,
    ):
        mock_llm_instance = AsyncMock()
        mock_llm_instance.generate = AsyncMock(return_value=llm_response)
        mock_get_llm.return_value = mock_llm_instance

        resp = await test_client.get(
            f"/api/v1/collections/{col.id}/commit-quality",
            headers=auth_headers,
        )
        # LLM was called exactly once (for the single uncached commit)
        mock_get_llm.assert_called_once()

    assert resp.status_code == 200
    data = resp.json()
    assert data["total_cache_hits"] == 1
    assert data["total_newly_scored"] == 1

    commits = data["repos"][0]["commits"]
    # First commit came from cache
    assert commits[0]["full_hash"] == cached_full_hash
    assert commits[0]["score"] == "bad"
    assert commits[0]["from_cache"] is True
    # Second commit was scored by LLM
    assert commits[1]["full_hash"] == new_full_hash
    assert commits[1]["score"] == "good"
    assert commits[1]["from_cache"] is False
