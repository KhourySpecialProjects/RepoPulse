"""Tests for the CommitClassification model (renamed from CommitQualityScore).

Covers the schema change that adds a Substantive/Logistical `commit_type`
alongside the existing message-quality `score`.
"""
from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.collection import Collection
from app.models.commit_classification import CommitClassification
from app.models.repo import Repo
from app.models.user import User


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _make_repo(db: AsyncSession, owner_id: uuid.UUID) -> Repo:
    col = Collection(
        id=uuid.uuid4(),
        name="Test Collection",
        local_folder_name="test-col",
        owner_id=owner_id,
    )
    db.add(col)
    await db.flush()

    repo = Repo(
        id=uuid.uuid4(),
        collection_id=col.id,
        github_url="https://github.com/test/repo",
        name="repo",
    )
    db.add(repo)
    await db.flush()
    return repo


def _hash(seed: str) -> str:
    """Deterministic 40-char hex string standing in for a commit SHA."""
    return seed.ljust(40, "0")[:40]


# ---------------------------------------------------------------------------
# Table identity
# ---------------------------------------------------------------------------


def test_table_is_named_commit_classifications() -> None:
    """The table is renamed from commit_quality_scores now that it holds type too."""
    assert CommitClassification.__tablename__ == "commit_classifications"


# ---------------------------------------------------------------------------
# commit_type round-trips
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("commit_type", ["substantive", "logistical"])
async def test_commit_type_round_trips(
    db_session: AsyncSession, test_user: User, commit_type: str
) -> None:
    repo = await _make_repo(db_session, test_user.id)

    db_session.add(
        CommitClassification(
            id=uuid.uuid4(),
            repo_id=repo.id,
            commit_hash=_hash("abc"),
            score="good",
            commit_type=commit_type,
            model_used="claude-sonnet-5",
        )
    )
    await db_session.flush()

    row = (
        await db_session.execute(
            select(CommitClassification).where(
                CommitClassification.repo_id == repo.id
            )
        )
    ).scalar_one()

    assert row.commit_type == commit_type
    assert row.score == "good"
    assert row.scored_at is not None


async def test_commit_type_is_nullable(
    db_session: AsyncSession, test_user: User
) -> None:
    """Rows written before this migration have a score but no type."""
    repo = await _make_repo(db_session, test_user.id)

    db_session.add(
        CommitClassification(
            id=uuid.uuid4(),
            repo_id=repo.id,
            commit_hash=_hash("def"),
            score="ok",
            commit_type=None,
            model_used="claude-sonnet-5",
        )
    )
    await db_session.flush()

    row = (
        await db_session.execute(
            select(CommitClassification).where(
                CommitClassification.repo_id == repo.id
            )
        )
    ).scalar_one()

    assert row.commit_type is None
    assert row.score == "ok"


async def test_score_is_nullable(
    db_session: AsyncSession, test_user: User
) -> None:
    """A commit may be typed without being quality-scored."""
    repo = await _make_repo(db_session, test_user.id)

    db_session.add(
        CommitClassification(
            id=uuid.uuid4(),
            repo_id=repo.id,
            commit_hash=_hash("aaa"),
            score=None,
            commit_type="substantive",
            model_used="claude-sonnet-5",
        )
    )
    await db_session.flush()

    row = (
        await db_session.execute(
            select(CommitClassification).where(
                CommitClassification.repo_id == repo.id
            )
        )
    ).scalar_one()

    assert row.score is None
    assert row.commit_type == "substantive"


# ---------------------------------------------------------------------------
# Constraints
# ---------------------------------------------------------------------------


async def test_invalid_commit_type_is_rejected(
    db_session: AsyncSession, test_user: User
) -> None:
    """Only 'substantive' and 'logistical' are allowed values."""
    repo = await _make_repo(db_session, test_user.id)

    with pytest.raises(IntegrityError):
        async with db_session.begin_nested():
            db_session.add(
                CommitClassification(
                    id=uuid.uuid4(),
                    repo_id=repo.id,
                    commit_hash=_hash("bad"),
                    score="good",
                    commit_type="random",
                    model_used="claude-sonnet-5",
                )
            )
            await db_session.flush()


async def test_invalid_score_is_rejected(
    db_session: AsyncSession, test_user: User
) -> None:
    """The existing good/ok/bad vocabulary is enforced too."""
    repo = await _make_repo(db_session, test_user.id)

    with pytest.raises(IntegrityError):
        async with db_session.begin_nested():
            db_session.add(
                CommitClassification(
                    id=uuid.uuid4(),
                    repo_id=repo.id,
                    commit_hash=_hash("bad2"),
                    score="excellent",
                    commit_type="substantive",
                    model_used="claude-sonnet-5",
                )
            )
            await db_session.flush()


async def test_repo_hash_uniqueness_still_holds(
    db_session: AsyncSession, test_user: User
) -> None:
    """One classification per (repo, commit) — the upsert path depends on this."""
    repo = await _make_repo(db_session, test_user.id)
    commit_hash = _hash("dup")

    db_session.add(
        CommitClassification(
            id=uuid.uuid4(),
            repo_id=repo.id,
            commit_hash=commit_hash,
            score="good",
            commit_type="substantive",
            model_used="claude-sonnet-5",
        )
    )
    await db_session.flush()

    with pytest.raises(IntegrityError):
        async with db_session.begin_nested():
            db_session.add(
                CommitClassification(
                    id=uuid.uuid4(),
                    repo_id=repo.id,
                    commit_hash=commit_hash,
                    score="bad",
                    commit_type="logistical",
                    model_used="claude-sonnet-5",
                )
            )
            await db_session.flush()


async def test_same_hash_allowed_across_repos(
    db_session: AsyncSession, test_user: User
) -> None:
    """Uniqueness is scoped per repo, not global — forks share hashes."""
    repo_a = await _make_repo(db_session, test_user.id)
    repo_b = await _make_repo(db_session, test_user.id)
    commit_hash = _hash("shared")

    for repo in (repo_a, repo_b):
        db_session.add(
            CommitClassification(
                id=uuid.uuid4(),
                repo_id=repo.id,
                commit_hash=commit_hash,
                score="good",
                commit_type="substantive",
                model_used="claude-sonnet-5",
            )
        )
    await db_session.flush()

    rows = (
        await db_session.execute(
            select(CommitClassification).where(
                CommitClassification.commit_hash == commit_hash
            )
        )
    ).scalars().all()

    assert len(rows) == 2
