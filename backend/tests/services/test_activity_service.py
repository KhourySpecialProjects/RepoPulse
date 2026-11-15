"""Daily activity per repo and per student, read from the stored commits."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.collection import Collection
from app.models.repo import Repo
from app.models.user import User
from app.services import commit_snapshot_service
from app.services.activity_service import collect_activity


def _commit(sha: str, email: str, when: datetime) -> dict:
    """One entry shaped like GitService.parse_commits output."""
    return {
        "hash": sha,
        "author_name": email.split("@")[0],
        "author_email": email,
        "date": when,
        "message": f"commit {sha}",
        "branches": ["main"],
        "origin_branch": "main",
        "insertions": 1,
        "deletions": 0,
        "files_changed": 1,
    }


NOON = datetime(2026, 9, 1, 12, 0, tzinfo=timezone.utc)


async def _repo(db: AsyncSession, owner: User, name: str, contributors=()) -> SimpleNamespace:
    """A stored Repo row, viewed the way collect_activity reads it.

    The row exists so stored commits have a repo to belong to; the namespace
    carries contributors without an async lazy-load of the relationship.
    """
    collection = Collection(
        id=uuid.uuid4(), name=name, local_folder_name=f"{name}-{uuid.uuid4().hex[:6]}",
        owner_id=owner.id,
    )
    db.add(collection)
    await db.flush()
    row = Repo(
        id=uuid.uuid4(), collection_id=collection.id, name=name,
        github_url=f"https://github.com/test/{name}", local_path=f"/repos/{name}",
    )
    db.add(row)
    await db.flush()
    return SimpleNamespace(
        id=row.id, name=name, local_path=row.local_path, sync_error=None,
        contributors=list(contributors),
    )


def _git(**kwargs) -> SimpleNamespace:
    return SimpleNamespace(parse_commits=AsyncMock(**kwargs))


@pytest.mark.asyncio
async def test_collect_activity_keeps_repo_counts_and_merged_student_aliases(
    db_session: AsyncSession, test_user: User
) -> None:
    student = SimpleNamespace(
        id="student", display_name="Alice",
        aliases=[SimpleNamespace(git_email="A@EXAMPLE.COM"), SimpleNamespace(git_email="other@example.com")],
    )
    one = await _repo(db_session, test_user, "one", [student])
    two = await _repo(db_session, test_user, "two")
    commits = [_commit("a" * 40, "a@example.com", NOON), _commit("b" * 40, "other@example.com", NOON)]

    result = await collect_activity([one, two], _git(return_value=commits + [commits[0]]), db_session)

    assert result[0].activity[0].count == 2
    assert result[1].activity[0].count == 2
    assert result[0].students[0].activity[0].count == 2


@pytest.mark.asyncio
async def test_stored_history_is_read_without_parsing_the_clone(
    db_session: AsyncSession, test_user: User
) -> None:
    repo = await _repo(db_session, test_user, "stored")
    await commit_snapshot_service.store(db_session, repo.id, [_commit("c" * 40, "c@example.com", NOON)])
    git = _git(side_effect=AssertionError("stored history must not be re-parsed"))

    result = await collect_activity([repo], git, db_session)

    assert result[0].available is True
    assert result[0].stale is False
    assert result[0].activity[0].count == 1
    git.parse_commits.assert_not_awaited()


@pytest.mark.asyncio
async def test_a_failed_last_sync_marks_the_activity_stale(
    db_session: AsyncSession, test_user: User
) -> None:
    repo = await _repo(db_session, test_user, "failed-sync")
    await commit_snapshot_service.store(db_session, repo.id, [_commit("d" * 40, "d@example.com", NOON)])
    repo.sync_error = "fetch failed"

    result = await collect_activity([repo], _git(return_value=[]), db_session)

    assert result[0].available is True
    assert result[0].stale is True


@pytest.mark.asyncio
async def test_unreadable_repository_is_explicitly_unavailable(
    db_session: AsyncSession, test_user: User
) -> None:
    repo = await _repo(db_session, test_user, "broken")

    result = await collect_activity([repo], _git(side_effect=RuntimeError("broken")), db_session)

    assert result[0].available is False
    assert result[0].activity == []


@pytest.mark.asyncio
async def test_activity_uses_utc_dates_and_complete_history(
    db_session: AsyncSession, test_user: User
) -> None:
    repo = await _repo(db_session, test_user, "utc")
    after_midnight_in_paris = datetime(2026, 9, 2, 0, 30, tzinfo=timezone(timedelta(hours=2)))
    commits = [_commit(f"{i:040d}", "a@example.com", after_midnight_in_paris) for i in range(600)]

    result = await collect_activity([repo], _git(return_value=commits), db_session)

    assert result[0].activity[0].date == "2026-09-01"
    assert result[0].activity[0].count == 600
