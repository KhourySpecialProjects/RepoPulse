"""Persist and re-serve what the last successful sync parsed from a clone.

`store` is called by indexing; `load` is called by the read paths when the
clone will not open. The dicts `load` returns are the same shape
`GitService.parse_commits` emits, so callers can fall back without branching on
where the data came from.
"""
from __future__ import annotations

import uuid
from typing import Any, Sequence

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.commit import Commit

#: What `load` fills in for fields the snapshot does not carry. The per-commit
#: file list and diffstat availability are only needed by classification, which
#: reads the clone directly and never falls back to a snapshot.
_ABSENT_FROM_SNAPSHOT: dict[str, Any] = {
    "file_paths": [],
    "file_paths_truncated": False,
    "diffstat_available": False,
}


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

    Empty when nothing was ever stored, which the callers read as "there is no
    fallback either" rather than "this repo has no commits".
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
