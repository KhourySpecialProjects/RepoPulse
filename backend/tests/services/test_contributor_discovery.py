"""Tests for contributor discovery (_upsert_contributors) — written first per TDD convention."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy.ext.asyncio import AsyncSession


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_commit(
    email: str = "alice@example.com",
    name: str = "Alice",
    days_ago: int = 1,
    insertions: int = 10,
    deletions: int = 2,
) -> dict:
    return {
        "hash": uuid.uuid4().hex[:8],
        "author_name": name,
        "author_email": email,
        "date": datetime(2026, 3, 21, 12, 0, 0, tzinfo=timezone.utc) - timedelta(days=days_ago),
        "message": "some commit",
        "branch": "main",
        "insertions": insertions,
        "deletions": deletions,
        "files_changed": 1,
    }


# ---------------------------------------------------------------------------
# Unit tests using real test DB (via conftest fixtures)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_upsert_contributors_creates_new_contributor(db_session: AsyncSession) -> None:
    """When no contributor exists for an email, a new Contributor + alias is created."""
    from app.api.routes.repos import _upsert_contributors
    from app.models.contributor import Contributor
    from app.models.contributor_alias import ContributorAlias
    from sqlalchemy import select

    repo_id = uuid.uuid4()
    commits = [
        _make_commit("alice@example.com", "Alice", days_ago=3, insertions=5, deletions=1),
        _make_commit("alice@example.com", "Alice", days_ago=1, insertions=20, deletions=5),
    ]

    await _upsert_contributors(db_session, repo_id, commits)
    await db_session.flush()

    result = await db_session.execute(
        select(Contributor).where(Contributor.repo_id == repo_id)
    )
    contributors = result.scalars().all()

    assert len(contributors) == 1
    c = contributors[0]
    assert c.display_name == "Alice"
    assert c.commit_count == 2
    assert c.total_insertions == 25
    assert c.total_deletions == 6
    assert c.last_commit_at is not None

    alias_result = await db_session.execute(
        select(ContributorAlias).where(ContributorAlias.contributor_id == c.id)
    )
    aliases = alias_result.scalars().all()
    assert len(aliases) == 1
    assert aliases[0].git_email == "alice@example.com"
    assert aliases[0].git_name == "Alice"


@pytest.mark.asyncio
async def test_upsert_contributors_multiple_authors(db_session: AsyncSession) -> None:
    """Two distinct emails produce two Contributor rows."""
    from app.api.routes.repos import _upsert_contributors
    from app.models.contributor import Contributor
    from sqlalchemy import select

    repo_id = uuid.uuid4()
    commits = [
        _make_commit("alice@example.com", "Alice", insertions=10, deletions=2),
        _make_commit("bob@example.com", "Bob", insertions=5, deletions=1),
    ]

    await _upsert_contributors(db_session, repo_id, commits)
    await db_session.flush()

    result = await db_session.execute(
        select(Contributor).where(Contributor.repo_id == repo_id)
    )
    contributors = result.scalars().all()
    names = {c.display_name for c in contributors}
    assert names == {"Alice", "Bob"}


@pytest.mark.asyncio
async def test_upsert_contributors_idempotent_on_second_call(db_session: AsyncSession) -> None:
    """Calling _upsert_contributors twice with the same commits updates stats, not duplicates."""
    from app.api.routes.repos import _upsert_contributors
    from app.models.contributor import Contributor
    from app.models.contributor_alias import ContributorAlias
    from sqlalchemy import select

    repo_id = uuid.uuid4()
    commits = [
        _make_commit("alice@example.com", "Alice", insertions=10, deletions=2),
    ]

    await _upsert_contributors(db_session, repo_id, commits)
    await db_session.flush()
    # Call a second time — should update, not create a duplicate
    await _upsert_contributors(db_session, repo_id, commits)
    await db_session.flush()

    result = await db_session.execute(
        select(Contributor).where(Contributor.repo_id == repo_id)
    )
    contributors = result.scalars().all()
    assert len(contributors) == 1

    alias_result = await db_session.execute(
        select(ContributorAlias).where(ContributorAlias.contributor_id == contributors[0].id)
    )
    aliases = alias_result.scalars().all()
    assert len(aliases) == 1


@pytest.mark.asyncio
async def test_upsert_contributors_multiple_names_same_email(db_session: AsyncSession) -> None:
    """Different git_names for the same email produce separate aliases but one Contributor."""
    from app.api.routes.repos import _upsert_contributors
    from app.models.contributor import Contributor
    from app.models.contributor_alias import ContributorAlias
    from sqlalchemy import select

    repo_id = uuid.uuid4()
    commits = [
        _make_commit("alice@example.com", "Alice Smith", days_ago=5, insertions=3, deletions=1),
        _make_commit("alice@example.com", "A. Smith", days_ago=1, insertions=7, deletions=2),
    ]

    await _upsert_contributors(db_session, repo_id, commits)
    await db_session.flush()

    result = await db_session.execute(
        select(Contributor).where(Contributor.repo_id == repo_id)
    )
    contributors = result.scalars().all()
    assert len(contributors) == 1

    alias_result = await db_session.execute(
        select(ContributorAlias).where(ContributorAlias.contributor_id == contributors[0].id)
    )
    aliases = alias_result.scalars().all()
    alias_names = {a.git_name for a in aliases}
    assert alias_names == {"Alice Smith", "A. Smith"}

    # Display name should be from the most recent commit (days_ago=1 → "A. Smith")
    assert contributors[0].display_name == "A. Smith"


@pytest.mark.asyncio
async def test_upsert_contributors_stats_accuracy(db_session: AsyncSession) -> None:
    """Stats are correctly aggregated: commit_count, insertions, deletions, last_commit_at."""
    from app.api.routes.repos import _upsert_contributors
    from app.models.contributor import Contributor
    from sqlalchemy import select

    repo_id = uuid.uuid4()
    t1 = datetime(2026, 1, 1, tzinfo=timezone.utc)
    t2 = datetime(2026, 2, 1, tzinfo=timezone.utc)
    t3 = datetime(2026, 3, 1, tzinfo=timezone.utc)

    commits = [
        {**_make_commit("dev@example.com", "Dev", insertions=10, deletions=1), "date": t1},
        {**_make_commit("dev@example.com", "Dev", insertions=20, deletions=3), "date": t2},
        {**_make_commit("dev@example.com", "Dev", insertions=5, deletions=0), "date": t3},
    ]

    await _upsert_contributors(db_session, repo_id, commits)
    await db_session.flush()

    result = await db_session.execute(
        select(Contributor).where(Contributor.repo_id == repo_id)
    )
    c = result.scalars().one()
    assert c.commit_count == 3
    assert c.total_insertions == 35
    assert c.total_deletions == 4
    assert c.last_commit_at == t3


@pytest.mark.asyncio
async def test_upsert_contributors_empty_commits(db_session: AsyncSession) -> None:
    """Empty commit list produces no contributor rows."""
    from app.api.routes.repos import _upsert_contributors
    from app.models.contributor import Contributor
    from sqlalchemy import select

    repo_id = uuid.uuid4()
    await _upsert_contributors(db_session, repo_id, [])
    await db_session.flush()

    result = await db_session.execute(
        select(Contributor).where(Contributor.repo_id == repo_id)
    )
    contributors = result.scalars().all()
    assert contributors == []
