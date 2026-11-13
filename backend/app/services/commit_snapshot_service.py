"""The `commits` table: every page's source of commit history.

Parsing a clone runs one `git diff` per commit — about 12 ms each, so 25 s for
a 2,000-commit repo — and nothing reused the result, so every commit list,
graph and summary paid it again. Sync is the only thing that changes a clone,
and sync already parses it and calls `store`; reading the table instead gives
the same history for the cost of a query.

`read` and `ensure` cover a repo that has never been stored (synced before
this table existed): its first read parses the clone once and stores it.
The dicts `load` returns are the same shape `GitService.parse_commits` emits.
"""
from __future__ import annotations

import asyncio
import logging
import uuid
from typing import Any, Protocol, Sequence

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.commit import Commit
from app.models.repo import Repo

logger = logging.getLogger(__name__)

#: What `load` fills in for fields the table does not carry. The per-commit
#: file list and diffstat availability are only needed by classification,
#: which still parses the clone itself.
_ABSENT_FROM_SNAPSHOT: dict[str, Any] = {
    "file_paths": [],
    "file_paths_truncated": False,
    "diffstat_available": False,
}

#: One lock per repo, so two first views of an unstored repo share one parse
#: instead of both storing it — the second store would collide with the first
#: on uq_commit_repo_hash. Process-local is enough: the backend runs a single
#: uvicorn process (see the `_in_flight` note in routes/commit_classification).
_backfill_locks: dict[uuid.UUID, asyncio.Lock] = {}


class CommitParser(Protocol):
    async def parse_commits(self, local_path: str) -> list[dict[str, Any]]: ...


async def store(
    db: AsyncSession, repo_id: uuid.UUID, commits: Sequence[dict]
) -> int:
    """Replace this repo's snapshot with ``commits``. Does not commit.

    A wholesale replace rather than an upsert: `parse_commits` returns the full
    history every time, so a commit that is absent now has genuinely gone —
    rewritten by a force-push, or on a branch that was deleted — and upserting
    would leave it behind forever.

    An empty ``commits`` is ignored rather than treated as a wipe. A repo that
    truly has no commits has nothing worth keeping anyway, whereas a parse that
    came back empty because the clone is broken would otherwise destroy the
    good snapshot that exists precisely for that case.
    """
    if not commits:
        return 0

    await db.execute(delete(Commit).where(Commit.repo_id == repo_id))

    # Last occurrence wins, so a duplicated SHA cannot violate the unique
    # constraint and abort the whole sync.
    unique = {commit["hash"]: commit for commit in commits}
    db.add_all(
        [
            Commit(
                repo_id=repo_id,
                hash=commit["hash"],
                author_name=commit.get("author_name") or "",
                author_email=commit.get("author_email") or "",
                date=commit["date"],
                message=commit.get("message") or "",
                branches=list(commit.get("branches") or []),
                origin_branch=commit.get("origin_branch") or "",
                insertions=commit.get("insertions") or 0,
                deletions=commit.get("deletions") or 0,
                files_changed=commit.get("files_changed") or 0,
            )
            for commit in unique.values()
        ]
    )
    return len(unique)


async def load(db: AsyncSession, repo_id: uuid.UUID) -> list[dict]:
    """This repo's stored commits, newest first, shaped like `parse_commits`.

    Empty when nothing was ever stored. Readers go through `read`, which
    fills an unstored repo first.
    """
    rows = await db.execute(
        select(Commit)
        .where(Commit.repo_id == repo_id)
        .order_by(Commit.date.desc())
    )
    return [
        {
            "hash": row.hash,
            "author_name": row.author_name,
            "author_email": row.author_email,
            "date": row.date,
            "message": row.message,
            "branches": list(row.branches or []),
            "origin_branch": row.origin_branch,
            "insertions": row.insertions,
            "deletions": row.deletions,
            "files_changed": row.files_changed,
            **_ABSENT_FROM_SNAPSHOT,
        }
        for row in rows.scalars().all()
    ]


async def _has_rows(db: AsyncSession, repo_id: uuid.UUID) -> bool:
    found = await db.execute(
        select(Commit.id).where(Commit.repo_id == repo_id).limit(1)
    )
    return found.first() is not None


async def ensure(db: AsyncSession, repo: Repo, git: CommitParser) -> bool:
    """Make sure ``repo`` has stored commits, parsing its clone if it has none.

    True when there is history to show: rows are stored, or the clone parsed
    (an empty repo parses to nothing and is still a valid, empty history).
    False when nothing is stored and there is no readable clone to fill it
    from. Commits the session when it stores, so the parse is paid once.
    """
    if await _has_rows(db, repo.id):
        return True
    if not repo.local_path:
        return False
    async with _backfill_locks.setdefault(repo.id, asyncio.Lock()):
        # Another request may have stored it while this one waited.
        if await _has_rows(db, repo.id):
            return True
        try:
            parsed = await git.parse_commits(repo.local_path)
        except Exception as exc:
            logger.warning(
                "commits: cannot parse %s (%s) to fill its stored history: %s",
                repo.name, repo.local_path, exc,
            )
            return False
        if await store(db, repo.id, parsed):
            await db.commit()
        return True


async def read(
    db: AsyncSession, repo: Repo, git: CommitParser
) -> list[dict] | None:
    """``repo``'s commits as of its last sync, newest first.

    None when there is no history to show — see `ensure`.
    """
    if not await ensure(db, repo, git):
        return None
    return await load(db, repo.id)


def is_stale(repo: Repo) -> bool:
    """Whether ``repo``'s stored history may be behind its remote: the last
    sync failed, or there is no clone on this machine to sync into."""
    return repo.sync_error is not None or not repo.local_path


async def daily_counts(
    db: AsyncSession, repo_ids: Sequence[uuid.UUID]
) -> list[tuple[str, int]]:
    """Commits per UTC day across ``repo_ids``, oldest day first.

    A SHA stored under two repos (a fork, a shared template) is one commit.
    Callers `ensure` each repo first; this only reads.
    """
    if not repo_ids:
        return []
    day = func.to_char(func.timezone("UTC", Commit.date), "YYYY-MM-DD")
    rows = await db.execute(
        select(day, func.count(func.distinct(Commit.hash)))
        .where(Commit.repo_id.in_(repo_ids))
        .group_by(day)
        .order_by(day)
    )
    return [(date, count) for date, count in rows.all()]
