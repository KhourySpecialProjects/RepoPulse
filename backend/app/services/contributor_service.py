"""Reversible contributor merges; each snapshot preserves the previous groups."""
from __future__ import annotations

import logging
import uuid
from datetime import datetime

from git.exc import GitError
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.contributor import Contributor
from app.models.contributor_alias import ContributorAlias
from app.models.note import Note
from app.models.repo import Repo
from app.models.summary import Summary
from app.services.git_service import GitService
from app.services.permission_service import can_write_collection


logger = logging.getLogger(__name__)


class ContributorOperationError(Exception):
    def __init__(self, status_code: int, detail: str, error_code: str):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail
        self.error_code = error_code


async def _lock_repo(db: AsyncSession, contributor_id: uuid.UUID, user_id: uuid.UUID) -> Repo:
    repo_id = await db.scalar(select(Contributor.repo_id).where(Contributor.id == contributor_id))
    if repo_id is None:
        raise ContributorOperationError(404, "Contributor not found", "NOT_FOUND")
    # Serialize merge/unmerge operations within this repository, including overlapping groups.
    repo = await db.scalar(select(Repo).where(Repo.id == repo_id).with_for_update())
    if not await can_write_collection(db, user_id, repo.collection_id):
        raise ContributorOperationError(403, "You cannot modify contributors in this collection", "FORBIDDEN")
    return repo


async def _load(db: AsyncSession, ids: list[uuid.UUID]) -> list[Contributor]:
    rows = (await db.scalars(select(Contributor).where(Contributor.id.in_(ids))
                            .execution_options(populate_existing=True))).all()
    by_id = {c.id: c for c in rows}
    if len(by_id) != len(ids):
        raise ContributorOperationError(404, "Contributor not found", "NOT_FOUND")
    return [by_id[cid] for cid in ids]


def _snapshot(c: Contributor) -> dict:
    return {
        "id": str(c.id), "display_name": c.display_name,
        "created_at": c.created_at.isoformat(),
        "commit_count": c.commit_count, "total_insertions": c.total_insertions,
        "total_deletions": c.total_deletions,
        "last_commit_at": c.last_commit_at.isoformat() if c.last_commit_at else None,
        "merge_history": c.merge_history,
        "aliases": [str(a.id) for a in c.aliases],
        "notes": [str(n.id) for n in c.notes],
        "summaries": [str(s.id) for s in c.summaries],
    }


async def merge_contributors(db: AsyncSession, ids: list[uuid.UUID], name: str,
                             user_id: uuid.UUID) -> Contributor:
    if len(ids) < 2 or len(set(ids)) != len(ids):
        raise ContributorOperationError(400, "Select at least two different contributors", "INVALID_CONTRIBUTORS")
    if not name.strip():
        raise ContributorOperationError(400, "A display name is required", "INVALID_NAME")
    repo = await _lock_repo(db, ids[0], user_id)
    contributors = await _load(db, ids)
    if any(c.repo_id != repo.id for c in contributors):
        raise ContributorOperationError(400, "Contributors must belong to the same repository", "DIFFERENT_REPOSITORIES")
    primary = contributors[0]
    primary.merge_history = [_snapshot(c) for c in contributors]
    primary.display_name = name.strip()
    primary.commit_count = sum(c.commit_count for c in contributors)
    primary.total_insertions = sum(c.total_insertions for c in contributors)
    primary.total_deletions = sum(c.total_deletions for c in contributors)
    dates = [c.last_commit_at for c in contributors if c.last_commit_at]
    primary.last_commit_at = max(dates) if dates else None
    await db.flush()
    secondary_ids = ids[1:]
    for model in (ContributorAlias, Note, Summary):
        await db.execute(update(model).where(model.contributor_id.in_(secondary_ids))
                         .values(contributor_id=primary.id))
    # Bulk deletion avoids ORM re-parenting already moved relationships to NULL.
    await db.execute(delete(Contributor).where(Contributor.id.in_(secondary_ids)))
    await db.commit()
    return (await _load(db, [primary.id]))[0]


async def unmerge_contributor(db: AsyncSession, contributor_id: uuid.UUID,
                              user_id: uuid.UUID) -> list[Contributor]:
    repo = await _lock_repo(db, contributor_id, user_id)
    primary = (await _load(db, [contributor_id]))[0]
    history = primary.merge_history
    if not history:
        raise ContributorOperationError(409, "No saved merge to undo for this contributor", "NO_MERGE_HISTORY")
    restored = []
    for snapshot in history:
        cid = uuid.UUID(snapshot["id"])
        c = primary if cid == primary.id else Contributor(id=cid, repo_id=primary.repo_id)
        c.display_name = snapshot["display_name"]
        c.created_at = datetime.fromisoformat(snapshot["created_at"])
        c.merge_history = snapshot["merge_history"]
        for field in ("commit_count", "total_insertions", "total_deletions"):
            setattr(c, field, snapshot[field])
        c.last_commit_at = datetime.fromisoformat(snapshot["last_commit_at"]) if snapshot["last_commit_at"] else None
        db.add(c)
        restored.append(c)
    await db.flush()
    for c, snapshot in zip(restored, history):
        if c.id == primary.id:
            continue
        for model, key in ((ContributorAlias, "aliases"), (Note, "notes"), (Summary, "summaries")):
            # New records stay with the primary; deleted or reassigned records are not resurrected.
            await db.execute(update(model).where(
                model.id.in_([uuid.UUID(value) for value in snapshot[key]]),
                model.contributor_id == primary.id,
            ).values(contributor_id=c.id))
    # A sync may have added commits since the merge. Recount using the restored
    # alias ownership rather than replacing current totals with stale snapshots.
    if repo.local_path:
        try:
            commits = await GitService().parse_commits(repo.local_path)
        except (GitError, OSError):
            logger.warning("History unavailable during unmerge; retaining saved contributor statistics")
        else:
            aliases = (await db.scalars(select(ContributorAlias).where(
                ContributorAlias.contributor_id.in_([c.id for c in restored])
            ))).all()
            by_id = {c.id: c for c in restored}
            by_email = {a.git_email.lower(): by_id[a.contributor_id] for a in aliases}
            for c in restored:
                c.commit_count = c.total_insertions = c.total_deletions = 0
                c.last_commit_at = None
            for commit in commits:
                c = by_email.get(commit["author_email"].lower())
                if c is None:
                    continue
                c.commit_count += 1
                c.total_insertions += commit["insertions"]
                c.total_deletions += commit["deletions"]
                if c.last_commit_at is None or commit["date"] > c.last_commit_at:
                    c.last_commit_at = commit["date"]
    await db.commit()
    return await _load(db, [c.id for c in restored])
