"""The `commits` table as the source every commit reader serves from.

Sync parses each clone and stores the result here. Reading it back instead of
re-parsing the clone on every request is what took the commit graph from 30s+
to a query. A repo with nothing stored yet (synced before the table existed)
is parsed once on its first read and stored.

`stale` on a response means the stored history may be behind the remote: the
last sync failed, or there is no clone on this machine to sync into.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
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
# Reading: the table is what every page reads; sync is what fills it
# ---------------------------------------------------------------------------


def _git(**kwargs) -> SimpleNamespace:
    """A stand-in GitService whose parse_commits is the only thing read uses."""
    return SimpleNamespace(parse_commits=AsyncMock(**kwargs))


async def test_stored_commits_are_read_without_touching_the_clone(
    db_session: AsyncSession, repo: Repo
) -> None:
    await commit_snapshot_service.store(db_session, repo.id, PARSED)
    git = _git(side_effect=AssertionError("must not parse a repo that has rows"))

    commits = await commit_snapshot_service.read(db_session, repo, git)

    assert [c["hash"] for c in commits] == [SHA_NEW, SHA_OLD]
    git.parse_commits.assert_not_awaited()


async def test_first_read_of_an_unstored_repo_parses_once_and_keeps_it(
    db_session: AsyncSession, repo: Repo
) -> None:
    """A repo synced before the table existed is parsed on first view, then
    never again until the next sync rewrites it."""
    git = _git(return_value=PARSED)

    first = await commit_snapshot_service.read(db_session, repo, git)
    second = await commit_snapshot_service.read(db_session, repo, git)

    assert [c["hash"] for c in first] == [SHA_NEW, SHA_OLD]
    assert [c["hash"] for c in second] == [SHA_NEW, SHA_OLD]
    assert git.parse_commits.await_count == 1


async def test_an_unreadable_clone_with_nothing_stored_has_no_history(
    db_session: AsyncSession, repo: Repo
) -> None:
    git = _git(side_effect=RuntimeError("not a git repository"))

    assert await commit_snapshot_service.read(db_session, repo, git) is None
    assert await commit_snapshot_service.load(db_session, repo.id) == []


async def test_a_readable_clone_with_no_commits_has_an_empty_history(
    db_session: AsyncSession, repo: Repo
) -> None:
    """Empty is an answer, not a failure: the commits page shows an empty
    table rather than an error."""
    git = _git(return_value=[])

    assert await commit_snapshot_service.read(db_session, repo, git) == []


async def test_a_repo_with_no_clone_is_never_parsed(
    db_session: AsyncSession, repo: Repo
) -> None:
    repo.local_path = None
    await db_session.flush()
    git = _git(side_effect=AssertionError("there is no clone to parse"))

    assert await commit_snapshot_service.read(db_session, repo, git) is None


async def test_daily_counts_count_a_shared_commit_once(
    db_session: AsyncSession, repo: Repo
) -> None:
    """A fork or shared template puts the same SHA in two repos; the
    collection graph counts the work once."""
    other = Repo(
        id=uuid.uuid4(),
        collection_id=repo.collection_id,
        github_url="https://github.com/test/fork",
        name="fork",
        local_path="/fake/path/fork",
        health_status="green",
    )
    db_session.add(other)
    await db_session.flush()
    await commit_snapshot_service.store(db_session, repo.id, PARSED)
    await commit_snapshot_service.store(db_session, other.id, [PARSED[0]])

    counts = await commit_snapshot_service.daily_counts(
        db_session, [repo.id, other.id]
    )

    assert counts == [("2026-01-01", 1), ("2026-01-03", 1)]


async def test_daily_counts_bucket_by_utc_day(
    db_session: AsyncSession, repo: Repo
) -> None:
    """11:30pm in Boston on Jan 5 is Jan 6 in UTC — the same day the
    contextual activity chart puts it on."""
    late = _commit(SHA_NEW, day=5)
    late["date"] = datetime(2026, 1, 5, 23, 30, tzinfo=timezone(timedelta(hours=-5)))
    await commit_snapshot_service.store(db_session, repo.id, [late])

    assert await commit_snapshot_service.daily_counts(db_session, [repo.id]) == [
        ("2026-01-06", 1)
    ]


async def test_daily_counts_of_no_repos_is_empty(db_session: AsyncSession) -> None:
    assert await commit_snapshot_service.daily_counts(db_session, []) == []


# ---------------------------------------------------------------------------
# Reading through the endpoint
# ---------------------------------------------------------------------------


async def test_stored_commits_are_served_without_parsing_the_clone(
    test_client: AsyncClient, auth_headers: dict, db_session: AsyncSession, repo: Repo
) -> None:
    await commit_snapshot_service.store(db_session, repo.id, PARSED)

    with _patch_parse(side_effect=AssertionError("stored history must not be re-parsed")):
        res = await test_client.get(
            f"/api/v1/repos/{repo.id}/commits", headers=auth_headers
        )

    body = res.json()
    assert res.status_code == 200
    assert [item["hash"] for item in body["items"]] == [SHA_NEW, SHA_OLD]
    assert body["stale"] is False


async def test_a_failed_last_sync_marks_the_commits_stale(
    test_client: AsyncClient, auth_headers: dict, db_session: AsyncSession, repo: Repo
) -> None:
    await commit_snapshot_service.store(db_session, repo.id, PARSED)
    repo.sync_status = "failed"
    repo.sync_error = "fetch failed: authentication required"
    await db_session.flush()

    res = await test_client.get(
        f"/api/v1/repos/{repo.id}/commits", headers=auth_headers
    )

    body = res.json()
    assert res.status_code == 200
    assert body["total"] == 2
    assert body["stale"] is True


async def test_a_repo_with_no_clone_serves_its_stored_history_as_stale(
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


async def test_filters_apply_to_stored_commits(
    test_client: AsyncClient, auth_headers: dict, db_session: AsyncSession, repo: Repo
) -> None:
    await commit_snapshot_service.store(db_session, repo.id, PARSED)

    res = await test_client.get(
        f"/api/v1/repos/{repo.id}/commits",
        params={"date_from": "2026-01-02T00:00:00Z"},
        headers=auth_headers,
    )

    body = res.json()
    assert [item["hash"] for item in body["items"]] == [SHA_NEW]


async def test_a_first_view_fills_the_table_and_is_not_stale(
    test_client: AsyncClient, auth_headers: dict, repo: Repo
) -> None:
    with _patch_parse(return_value=PARSED):
        res = await test_client.get(
            f"/api/v1/repos/{repo.id}/commits", headers=auth_headers
        )

    assert res.json()["stale"] is False


async def test_a_repo_summary_is_written_from_stored_commits(
    test_client: AsyncClient, auth_headers: dict, db_session: AsyncSession, repo: Repo
) -> None:
    from app.services.llm.base import TokenUsage

    await commit_snapshot_service.store(db_session, repo.id, PARSED)
    await db_session.commit()
    # A fresh load, as a real request gets: Repo.contributors is selectin, and
    # the instance this test built never ran that select.
    db_session.expunge_all()

    prompts: list[str] = []
    llm = AsyncMock()
    llm.usage = TokenUsage()

    async def generate(prompt: str, **kwargs: object) -> str:
        prompts.append(prompt)
        return "A summary."

    llm.generate = generate
    with (
        patch(
            "app.api.routes.summaries._git_service.parse_commits",
            new=AsyncMock(side_effect=AssertionError("stored history must not be re-parsed")),
        ),
        patch("app.api.routes.summaries.get_llm_service", return_value=llm),
    ):
        res = await test_client.post(
            "/api/v1/summaries/generate",
            headers=auth_headers,
            json={"summary_type": "repo_overview", "repo_id": str(repo.id)},
        )

    assert res.status_code == 201, res.text
    assert "commit on day 3" in prompts[0]
    assert "Total Commits: 2" in prompts[0]
