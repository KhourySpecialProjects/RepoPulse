"""Serving the last synced commits when the clone cannot be read.

Commits are parsed live from the local clone, which means a repo whose clone is
missing — a fresh container, a recreated bind mount, a machine that never did
the clone — renders an empty Commits table and an empty activity chart even
though the repo was synced successfully an hour ago.

So indexing now writes a snapshot of what it parsed, and the read paths fall
back to it. The response says `stale` when it did, because showing yesterday's
history as though it were live is worse than showing nothing.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.collection import Collection
from app.models.commit import Commit
from app.models.repo import Repo
from app.models.user import User
from app.services import commit_snapshot_service


def _sha(seed: str) -> str:
    return (seed * 40)[:40]


SHA_NEW = _sha("a1")
SHA_OLD = _sha("b2")


def _commit(sha: str, *, day: int, email: str = "alice@example.com") -> dict:
    """One entry shaped like GitService.parse_commits output."""
    return {
        "hash": sha,
        "author_name": "Alice",
        "author_email": email,
        "date": datetime(2026, 1, day, 12, 0, tzinfo=timezone.utc),
        "message": f"commit on day {day}",
        "branches": ["main"],
        "origin_branch": "main",
        "insertions": 100,
        "deletions": 10,
        "files_changed": 5,
    }


PARSED = [_commit(SHA_NEW, day=3), _commit(SHA_OLD, day=1, email="bob@example.com")]


def _patch_parse(**kwargs):
    return patch.object(
        __import__("app.api.routes.repos", fromlist=["_git_service"])._git_service,
        "parse_commits",
        new=AsyncMock(**kwargs),
    )


@pytest_asyncio.fixture
async def repo(db_session: AsyncSession, test_user: User) -> Repo:
    collection = Collection(
        id=uuid.uuid4(),
        name="Snapshot Collection",
        local_folder_name=f"snap-{uuid.uuid4().hex[:6]}",
        owner_id=test_user.id,
    )
    db_session.add(collection)
    await db_session.flush()

    row = Repo(
        id=uuid.uuid4(),
        collection_id=collection.id,
        github_url="https://github.com/test/snapshot-repo",
        name="snapshot-repo",
        local_path="/fake/path/snapshot-repo",
        health_status="green",
    )
    db_session.add(row)
    await db_session.flush()
    return row


# ---------------------------------------------------------------------------
# Writing the snapshot
# ---------------------------------------------------------------------------


async def test_storing_a_snapshot_round_trips(
    db_session: AsyncSession, repo: Repo
) -> None:
    await commit_snapshot_service.store(db_session, repo.id, PARSED)

    loaded = await commit_snapshot_service.load(db_session, repo.id)

    assert [c["hash"] for c in loaded] == [SHA_NEW, SHA_OLD]
    assert loaded[0]["author_name"] == "Alice"
    assert loaded[0]["branches"] == ["main"]
    assert loaded[0]["origin_branch"] == "main"
    assert loaded[0]["insertions"] == 100
    assert loaded[0]["date"] == PARSED[0]["date"]


async def test_a_resync_replaces_rather_than_accumulates(
    db_session: AsyncSession, repo: Repo
) -> None:
    """Re-parsing gives full history again, so the old snapshot is not additive."""
    await commit_snapshot_service.store(db_session, repo.id, PARSED)
    await commit_snapshot_service.store(db_session, repo.id, [PARSED[0]])

    rows = await db_session.execute(select(Commit).where(Commit.repo_id == repo.id))
    assert len(rows.scalars().all()) == 1


async def test_a_dropped_commit_disappears_from_the_snapshot(
    db_session: AsyncSession, repo: Repo
) -> None:
    """A force-push that rewrote history must not leave orphans behind."""
    await commit_snapshot_service.store(db_session, repo.id, PARSED)
    await commit_snapshot_service.store(db_session, repo.id, [PARSED[0]])

    loaded = await commit_snapshot_service.load(db_session, repo.id)
    assert [c["hash"] for c in loaded] == [SHA_NEW]


async def test_storing_nothing_is_not_treated_as_a_wipe(
    db_session: AsyncSession, repo: Repo
) -> None:
    """A parse that returned nothing is far more likely a broken clone than a
    repo that genuinely lost every commit, so the good snapshot survives."""
    await commit_snapshot_service.store(db_session, repo.id, PARSED)
    await commit_snapshot_service.store(db_session, repo.id, [])

    loaded = await commit_snapshot_service.load(db_session, repo.id)
    assert len(loaded) == 2


async def test_snapshots_are_scoped_to_their_repo(
    db_session: AsyncSession, repo: Repo, test_user: User
) -> None:
    other = Repo(
        id=uuid.uuid4(),
        collection_id=repo.collection_id,
        github_url="https://github.com/test/other",
        name="other",
        local_path="/fake/path/other",
        health_status="green",
    )
    db_session.add(other)
    await db_session.flush()

    await commit_snapshot_service.store(db_session, repo.id, PARSED)

    assert await commit_snapshot_service.load(db_session, other.id) == []


# ---------------------------------------------------------------------------
# Reading through the endpoint
# ---------------------------------------------------------------------------


async def test_a_readable_clone_is_still_preferred(
    test_client: AsyncClient, auth_headers: dict, db_session: AsyncSession, repo: Repo
) -> None:
    """The snapshot is a fallback, not a cache — live data wins when available."""
    await commit_snapshot_service.store(db_session, repo.id, [PARSED[1]])

    with _patch_parse(return_value=PARSED):
        res = await test_client.get(
            f"/api/v1/repos/{repo.id}/commits", headers=auth_headers
        )

    body = res.json()
    assert res.status_code == 200
    assert body["total"] == 2
    assert body["stale"] is False


async def test_an_unreadable_clone_falls_back_to_the_snapshot(
    test_client: AsyncClient, auth_headers: dict, db_session: AsyncSession, repo: Repo
) -> None:
    await commit_snapshot_service.store(db_session, repo.id, PARSED)

    with _patch_parse(side_effect=RuntimeError("not a git repository")):
        res = await test_client.get(
            f"/api/v1/repos/{repo.id}/commits", headers=auth_headers
        )

    body = res.json()
    assert res.status_code == 200
    assert [item["hash"] for item in body["items"]] == [SHA_NEW, SHA_OLD]
    assert body["stale"] is True


async def test_a_missing_local_path_falls_back_to_the_snapshot(
    test_client: AsyncClient, auth_headers: dict, db_session: AsyncSession, repo: Repo
) -> None:
    await commit_snapshot_service.store(db_session, repo.id, PARSED)
    repo.local_path = None
    await db_session.flush()

    res = await test_client.get(
        f"/api/v1/repos/{repo.id}/commits", headers=auth_headers
    )

    assert res.status_code == 200
    assert res.json()["stale"] is True
    assert res.json()["total"] == 2


async def test_no_clone_and_no_snapshot_is_still_an_error(
    test_client: AsyncClient, auth_headers: dict, repo: Repo
) -> None:
    """With nothing to show, saying so beats an empty table that looks normal."""
    with _patch_parse(side_effect=RuntimeError("not a git repository")):
        res = await test_client.get(
            f"/api/v1/repos/{repo.id}/commits", headers=auth_headers
        )

    assert res.status_code == 400


async def test_filters_still_apply_to_snapshot_data(
    test_client: AsyncClient, auth_headers: dict, db_session: AsyncSession, repo: Repo
) -> None:
    """Falling back must not quietly turn the filters off."""
    await commit_snapshot_service.store(db_session, repo.id, PARSED)

    with _patch_parse(side_effect=RuntimeError("gone")):
        res = await test_client.get(
            f"/api/v1/repos/{repo.id}/commits",
            params={"date_from": "2026-01-02T00:00:00Z"},
            headers=auth_headers,
        )

    body = res.json()
    assert [item["hash"] for item in body["items"]] == [SHA_NEW]
    assert body["stale"] is True


async def test_live_reads_report_themselves_as_fresh(
    test_client: AsyncClient, auth_headers: dict, repo: Repo
) -> None:
    with _patch_parse(return_value=PARSED):
        res = await test_client.get(
            f"/api/v1/repos/{repo.id}/commits", headers=auth_headers
        )

    assert res.json()["stale"] is False
