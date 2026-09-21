"""Remove a repository's tracked data without touching local or remote git files."""
from __future__ import annotations

import uuid

from sqlalchemy import delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.util import identity_key

from app.models.commit_classification import CommitClassification
from app.models.contributor import Contributor
from app.models.contributor_alias import ContributorAlias
from app.models.note import Note
from app.models.note_comment import NoteComment
from app.models.notification import Notification
from app.models.pull_request import PullRequest
from app.models.repo import Repo
from app.models.summary import Summary


async def remove_repo_records(db: AsyncSession, repo_id: uuid.UUID) -> None:
    contributor_ids = select(Contributor.id).where(Contributor.repo_id == repo_id)
    note_ids = select(Note.id).where(or_(
        Note.repo_id == repo_id, Note.contributor_id.in_(contributor_ids)
    ))
    comment_ids = select(NoteComment.id).where(NoteComment.note_id.in_(note_ids))
    # Explicit child-first deletion also supports databases whose foreign keys
    # predate cascade rules. All writes commit together or roll back together.
    statements = [
        # Repo-scoped events (health, pull requests) reference the repo
        # directly. repo_removed rows deliberately carry no repo_id so they
        # survive this — see notification_service.notify_repo_event.
        delete(Notification).where(or_(
            Notification.note_id.in_(note_ids),
            Notification.comment_id.in_(comment_ids),
            Notification.repo_id == repo_id,
        )),
        delete(NoteComment).where(NoteComment.note_id.in_(note_ids)),
        delete(Note).where(Note.id.in_(note_ids)),
        delete(Summary).where(or_(Summary.repo_id == repo_id, Summary.contributor_id.in_(contributor_ids))),
        delete(ContributorAlias).where(ContributorAlias.contributor_id.in_(contributor_ids)),
        delete(Contributor).where(Contributor.repo_id == repo_id),
        delete(CommitClassification).where(CommitClassification.repo_id == repo_id),
        delete(PullRequest).where(PullRequest.repo_id == repo_id),
        delete(Repo).where(Repo.id == repo_id),
    ]
    try:
        for statement in statements:
            await db.execute(statement.execution_options(synchronize_session=False))
        await db.commit()
    except Exception:
        await db.rollback()
        raise

    # `synchronize_session=False` means the ORM never learns this row is gone,
    # so the session would keep serving it from its identity map and a second
    # `db.get(Repo, repo_id)` would return the deleted repo instead of None.
    # Detaching just that instance forces the next lookup to hit the database.
    #
    # Expiring the whole session instead would be worse: expired attributes
    # lazy-load on next access, and any of those reads landing outside a
    # greenlet context raises MissingGreenlet.
    stale = db.identity_map.get(identity_key(Repo, repo_id))
    if stale is not None:
        db.expunge(stale)
