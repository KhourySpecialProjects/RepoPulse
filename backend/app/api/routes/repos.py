from __future__ import annotations

import logging
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi.responses import JSONResponse
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status

logger = logging.getLogger(__name__)
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.deps import get_current_user, get_db_session
from app.models.collection import Collection
from app.models.contributor import Contributor
from app.models.user import User
from app.models.contributor_alias import ContributorAlias
from app.models.note import Note
from app.models.repo import Repo
from app.schemas.commits import CommitRead, PaginatedCommits
from app.schemas.contributors import ContributorRead, AliasRead
from app.schemas.errors import ErrorResponse
from app.schemas.health import HealthBreakdown
from app.schemas.repos import RepoSyncResult, AddReposRequest, RepoRead, RepoUpdate, PaginatedRepos
from app.services.git_service import GitService
from app.services.health_service import HealthService
from app.services.permission_service import (
    can_access_collection,
    can_write_collection,
)

router = APIRouter()

_git_service = GitService()
_health_service = HealthService()


def _derive_repo_name(github_url: str) -> str:
    """Derive a repo name from a GitHub URL."""
    name = github_url.rstrip("/").split("/")[-1]
    if name.endswith(".git"):
        name = name[:-4]
    return name or "unknown"


def _repo_to_read(repo: Repo, contributor_count: int | None = None, active_reminder_count: int = 0) -> RepoRead:
    if contributor_count is None:
        contributor_count = len(repo.contributors)
    return RepoRead(
        id=repo.id,
        collection_id=repo.collection_id,
        github_url=repo.github_url,
        name=repo.name,
        local_path=repo.local_path,
        health_status=repo.health_status,
        health_score=repo.health_score,
        last_synced_at=repo.last_synced_at,
        last_commit_at=repo.last_commit_at,
        expected_contributor_count=repo.expected_contributor_count,
        created_at=repo.created_at,
        updated_at=repo.updated_at,
        contributor_count=contributor_count,
        active_reminder_count=active_reminder_count,
    )


async def _upsert_contributors(
    db: AsyncSession, repo_id: uuid.UUID, commits: list[dict]
) -> None:
    """Compute per-contributor stats from commits and upsert Contributor + ContributorAlias rows."""
    if not commits:
        return

    by_email: dict[str, list[dict]] = {}
    for c in commits:
        email = c["author_email"].lower()
        by_email.setdefault(email, []).append(c)

    for email, author_commits in by_email.items():
        author_commits.sort(key=lambda c: c["date"])

        commit_count = len(author_commits)
        total_insertions = sum(c["insertions"] for c in author_commits)
        total_deletions = sum(c["deletions"] for c in author_commits)
        last_commit_at = author_commits[-1]["date"]
        display_name = author_commits[-1]["author_name"]

        alias_names: dict[str, str] = {}
        for c in author_commits:
            alias_names[c["author_name"]] = email

        existing_alias_result = await db.execute(
            select(ContributorAlias).where(
                ContributorAlias.git_email == email,
                ContributorAlias.contributor_id.in_(
                    select(Contributor.id).where(Contributor.repo_id == repo_id)
                ),
            )
        )
        existing_alias = existing_alias_result.scalars().first()

        if existing_alias is not None:
            contributor_result = await db.execute(
                select(Contributor).where(Contributor.id == existing_alias.contributor_id)
            )
            contributor = contributor_result.scalars().one()
        else:
            contributor = Contributor(
                repo_id=repo_id,
                display_name=display_name,
            )
            db.add(contributor)
            await db.flush()

        contributor.commit_count = commit_count
        contributor.total_insertions = total_insertions
        contributor.total_deletions = total_deletions
        contributor.last_commit_at = last_commit_at

        existing_aliases_result = await db.execute(
            select(ContributorAlias).where(
                ContributorAlias.contributor_id == contributor.id
            )
        )
        existing_alias_names: set[str] = {
            a.git_name for a in existing_aliases_result.scalars().all()
        }

        for git_name in alias_names:
            if git_name not in existing_alias_names:
                new_alias = ContributorAlias(
                    contributor_id=contributor.id,
                    git_email=email,
                    git_name=git_name,
                )
                db.add(new_alias)

    await db.flush()


async def _index_repo(repo_id: uuid.UUID, *, force_clone: bool = False, token: str | None = None, raise_errors: bool = False) -> None:
    """Clone (or fetch) a repo, parse commits, upsert contributors, update health."""
    from app.db.database import async_session_maker

    async with async_session_maker() as db:
        repo = await db.get(Repo, repo_id)
        if repo is None or not repo.local_path:
            if raise_errors:
                raise RuntimeError('Repository clone path is unavailable')
            return

        try:
            local_path = repo.local_path
            is_cloned = Path(local_path, ".git").exists()

            if force_clone or not is_cloned:
                logger.info("Cloning %s → %s", repo.github_url, local_path)
                await _git_service.clone_repo(repo.github_url, local_path, token=token)
            else:
                logger.info("Fetching %s", local_path)
                await _git_service.fetch_repo(local_path, token=token)

            t0 = time.perf_counter()
            commits = await _git_service.parse_commits(local_path)
            logger.debug("_index_repo: parse_commits returned %d commits in %.2fs — %s", len(commits), time.perf_counter() - t0, repo.name)
            branches = await _git_service.get_active_branches(local_path)

            await _upsert_contributors(db, repo_id, commits)
            await db.refresh(repo)
            actual_count = len(repo.contributors)

            health = _health_service.compute_health(
                commits,
                branches,
                expected_contributor_count=repo.expected_contributor_count,
                actual_contributor_count=actual_count,
            )

            repo.health_status = health["status"]
            repo.health_score = health
            repo.last_synced_at = datetime.utcnow()
            if commits:
                repo.last_commit_at = max(c["date"] for c in commits)
            await db.commit()
            logger.info("Indexed %s: %d commits, status=%s", repo.name, len(commits), health["status"])
        except Exception as exc:
            # Git errors may contain authenticated URLs. Never log raw exceptions.
            logger.error("Failed to index repo %s (%s)", repo.id, type(exc).__name__)
            if raise_errors:
                raise RuntimeError('Repository sync failed') from None


async def _clone_and_index(repo_id: uuid.UUID, token: str | None = None) -> None:
    await _index_repo(repo_id, force_clone=True, token=token)


async def _fetch_and_recompute(repo_id: uuid.UUID, token: str | None = None) -> None:
    await _index_repo(repo_id, force_clone=False, token=token, raise_errors=True)


@router.get(
    "/collections/{collection_id}/repos",
    response_model=PaginatedRepos,
    responses={404: {"model": ErrorResponse}},
)
async def list_repos(
    collection_id: uuid.UUID,
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user),
) -> PaginatedRepos:
    user_uuid = uuid.UUID(current_user_id)
    collection = await db.get(Collection, collection_id)
    if collection is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Collection not found",
        )

    if not await can_access_collection(db, user_uuid, collection_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Collection not found",
        )

    result = await db.execute(
        select(Repo)
        .where(Repo.collection_id == collection_id)
        .order_by(Repo.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    repos = result.scalars().all()

    count_result = await db.execute(
        select(func.count()).select_from(Repo).where(Repo.collection_id == collection_id)
    )
    total = count_result.scalar_one()

    repo_ids = [r.id for r in repos]
    reminder_counts: dict = {}
    if repo_ids:
        reminder_result = await db.execute(
            select(Note.repo_id, func.count(Note.id).label("cnt"))
            .where(
                Note.repo_id.in_(repo_ids),
                Note.is_reminder == True,   # noqa: E712
                Note.is_archived == False,  # noqa: E712
                Note.is_checked == False,   # noqa: E712
            )
            .group_by(Note.repo_id)
        )
        reminder_counts = {row.repo_id: row.cnt for row in reminder_result.all()}

    return PaginatedRepos(
        items=[_repo_to_read(r, active_reminder_count=reminder_counts.get(r.id, 0)) for r in repos],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.post(
    "/collections/{collection_id}/repos",
    response_model=list[RepoRead],
    status_code=status.HTTP_201_CREATED,
    responses={404: {"model": ErrorResponse}},
)
async def add_repos(
    collection_id: uuid.UUID,
    body: AddReposRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user),
) -> list[RepoRead]:
    user_uuid = uuid.UUID(current_user_id)
    collection = await db.get(Collection, collection_id)
    if collection is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Collection not found",
        )

    if not await can_access_collection(db, user_uuid, collection_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Collection not found",
        )

    # Look up user's GitHub token — required to clone repositories
    user_record = await db.get(User, user_uuid)
    if not user_record or not user_record.github_token:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="GitHub token not configured. Add a token in your profile to enable adding repositories.",
        )

    created_repos: list[RepoRead] = []
    for url in body.urls:
        name = _derive_repo_name(url)
        local_path = (
            f"{settings.REPO_ROOT_DIR}/{collection.local_folder_name}/{name}"
        )
        repo = Repo(
            collection_id=collection_id,
            github_url=url,
            name=name,
            local_path=local_path,
            health_status="unknown",
        )
        db.add(repo)
        await db.flush()
        background_tasks.add_task(_clone_and_index, repo.id, user_record.github_token)
        created_repos.append(_repo_to_read(repo, contributor_count=0))

    await db.commit()
    return created_repos


@router.get(
    "/repos/{repo_id}",
    response_model=RepoRead,
    responses={404: {"model": ErrorResponse}},
)
async def get_repo(
    repo_id: uuid.UUID,
    db: AsyncSession = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user),
) -> RepoRead:
    user_uuid = uuid.UUID(current_user_id)
    repo = await db.get(Repo, repo_id)
    if repo is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Repo not found",
        )
    if not await can_access_collection(db, user_uuid, repo.collection_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Repo not found",
        )
    return _repo_to_read(repo)


@router.delete(
    "/repos/{repo_id}",
    responses={404: {"model": ErrorResponse}},
)
async def delete_repo(
    repo_id: uuid.UUID,
    db: AsyncSession = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user),
) -> dict:
    user_uuid = uuid.UUID(current_user_id)
    repo = await db.get(Repo, repo_id)
    if repo is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Repo not found",
        )
    if not await can_access_collection(db, user_uuid, repo.collection_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Repo not found",
        )
    await db.delete(repo)
    await db.commit()
    return {"detail": "Repo deleted"}


@router.patch(
    "/repos/{repo_id}",
    response_model=RepoRead,
    responses={403: {"model": ErrorResponse}, 404: {"model": ErrorResponse}},
)
async def update_repo(
    repo_id: uuid.UUID,
    body: RepoUpdate,
    db: AsyncSession = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user),
) -> RepoRead:
    user_uuid = uuid.UUID(current_user_id)
    repo = await db.get(Repo, repo_id)
    if repo is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Repo not found")

    if not await can_access_collection(db, user_uuid, repo.collection_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Repo not found")

    if not await can_write_collection(db, user_uuid, repo.collection_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to update this repo",
        )

    update_data = body.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(repo, field, value)

    # If expected_contributor_count changed and we have a stored health score,
    # recompute participation + composite + status immediately so cards reflect the change.
    if 'expected_contributor_count' in update_data and repo.health_score:
        await db.flush()  # ensure the new value is visible
        actual = len(repo.contributors)
        expected = repo.expected_contributor_count if repo.expected_contributor_count else max(actual, 1)
        ratio = actual / expected
        if ratio >= 1.0:
            participation = 2.0
        elif ratio >= 0.6:
            participation = 1.0
        else:
            participation = 0.0
        score = dict(repo.health_score)
        score['participation'] = participation
        raw_sum = (
            score.get('commit_frequency', 0)
            + score.get('recency', 0)
            + score.get('distribution', 0)
            + score.get('branch_activity', 0)
            + score.get('commit_message_quality', 0)
            + participation
        )
        composite = round(raw_sum / 12, 4)
        if composite >= 0.75:
            score['status'] = 'green'
        elif composite >= 0.375:
            score['status'] = 'yellow'
        else:
            score['status'] = 'red'
        score['composite'] = composite
        repo.health_score = score
        repo.health_status = score['status']

    await db.commit()
    await db.refresh(repo)
    contributor_count = len(repo.contributors)
    return _repo_to_read(repo, contributor_count=contributor_count)


@router.post(
    "/repos/{repo_id}/sync",
    response_model=RepoSyncResult,
    responses={404: {"model": ErrorResponse}, 502: {"model": ErrorResponse}},
)
async def sync_repo(
    repo_id: uuid.UUID,
    db: AsyncSession = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user),
) -> RepoSyncResult | JSONResponse:
    user_uuid = uuid.UUID(current_user_id)
    repo = await db.get(Repo, repo_id)
    if repo is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Repo not found",
        )
    if not await can_access_collection(db, user_uuid, repo.collection_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Repo not found",
        )
    # Look up user's GitHub token — required to interact with GitHub
    user_record = await db.get(User, user_uuid)
    if not user_record or not user_record.github_token:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="GitHub token not configured. Add a token in your profile to enable syncing.",
        )
    try:
        await _fetch_and_recompute(repo_id, user_record.github_token)
    except Exception:
        return JSONResponse(status_code=502, content=ErrorResponse(
            detail="Sync failed. For a private repo, check that your GitHub token has Contents read access to this repository and any required organization approval. Also check the clone path and network connection.",
            error_code="REPO_SYNC_FAILED",
        ).model_dump())
    return RepoSyncResult(detail="Sync completed", repo_id=repo_id)


@router.get(
    "/repos/{repo_id}/health",
    response_model=HealthBreakdown,
    responses={404: {"model": ErrorResponse}, 400: {"model": ErrorResponse}},
)
async def get_repo_health(
    repo_id: uuid.UUID,
    db: AsyncSession = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user),
) -> HealthBreakdown:
    user_uuid = uuid.UUID(current_user_id)
    repo = await db.get(Repo, repo_id)
    if repo is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Repo not found",
        )
    if not await can_access_collection(db, user_uuid, repo.collection_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Repo not found",
        )
    if not repo.health_score:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Health data not available. Sync the repo first.",
        )

    score = dict(repo.health_score)
    actual_count = len(repo.contributors)
    expected_count = repo.expected_contributor_count
    actual = actual_count
    expected = expected_count if expected_count else max(actual, 1)
    ratio = actual / expected
    if ratio >= 1.0:
        participation = 2.0
    elif ratio >= 0.6:
        participation = 1.0
    else:
        participation = 0.0

    raw_sum = (
        score.get("commit_frequency", 0)
        + score.get("recency", 0)
        + score.get("distribution", 0)
        + score.get("branch_activity", 0)
        + score.get("commit_message_quality", 0)
        + participation
    )
    composite = round(raw_sum / 12, 4)
    if composite >= 0.75:
        health_status = "green"
    elif composite >= 0.375:
        health_status = "yellow"
    else:
        health_status = "red"

    score["participation"] = participation
    score["composite"] = composite
    score["status"] = health_status

    return HealthBreakdown(**score)


@router.get(
    "/repos/{repo_id}/commits",
    response_model=PaginatedCommits,
    responses={404: {"model": ErrorResponse}, 400: {"model": ErrorResponse}},
)
async def get_repo_commits(
    repo_id: uuid.UUID,
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    contributor_id: Optional[uuid.UUID] = Query(None),
    branch: Optional[str] = Query(None),
    date_from: Optional[datetime] = Query(None),
    date_to: Optional[datetime] = Query(None),
    db: AsyncSession = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user),
) -> PaginatedCommits:
    user_uuid = uuid.UUID(current_user_id)
    repo = await db.get(Repo, repo_id)
    if repo is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Repo not found",
        )
    if not await can_access_collection(db, user_uuid, repo.collection_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Repo not found",
        )
    if not repo.local_path:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Repo has no local path. Add and sync the repo first.",
        )

    try:
        t0 = time.perf_counter()
        all_commits = await _git_service.parse_commits(repo.local_path)
        logger.debug(
            "get_repo_commits: parse_commits returned %d commits in %.2fs (limit=%d offset=%d branch=%s) — %s",
            len(all_commits), time.perf_counter() - t0, limit, offset, branch, repo.name,
        )
    except Exception as exc:
        logger.exception("parse_commits failed for repo %s: %s", repo.local_path, exc)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Could not read commits: {exc}",
        )

    contributor_emails: set[str] = set()
    if contributor_id is not None:
        contributor = await db.get(Contributor, contributor_id)
        if contributor and contributor.aliases:
            contributor_emails = {a.git_email for a in contributor.aliases}

    filtered = []
    for c in all_commits:
        if contributor_emails and c["author_email"].lower() not in contributor_emails:
            continue
        if branch and branch not in c["branches"]:
            continue
        if date_from and c["date"] < date_from:
            continue
        if date_to and c["date"] > date_to:
            continue
        filtered.append(c)

    total = len(filtered)
    page = filtered[offset : offset + limit]

    items = [
        CommitRead(
            hash=c["hash"],
            author_name=c["author_name"],
            author_email=c["author_email"],
            date=c["date"],
            message=c["message"],
            branches=c["branches"],
            insertions=c["insertions"],
            deletions=c["deletions"],
            files_changed=c["files_changed"],
        )
        for c in page
    ]

    return PaginatedCommits(items=items, total=total, limit=limit, offset=offset)


@router.get(
    "/repos/{repo_id}/contributors",
    response_model=list[ContributorRead],
    responses={404: {"model": ErrorResponse}},
)
async def get_repo_contributors(
    repo_id: uuid.UUID,
    db: AsyncSession = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user),
) -> list[ContributorRead]:
    user_uuid = uuid.UUID(current_user_id)
    repo = await db.get(Repo, repo_id)
    if repo is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Repo not found",
        )
    if not await can_access_collection(db, user_uuid, repo.collection_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Repo not found",
        )

    return [
        ContributorRead(
            id=c.id,
            display_name=c.display_name,
            repo_id=c.repo_id,
            created_at=c.created_at,
            commit_count=c.commit_count,
            total_insertions=c.total_insertions,
            total_deletions=c.total_deletions,
            last_commit_at=c.last_commit_at,
            aliases=[
                AliasRead(id=a.id, git_email=a.git_email, git_name=a.git_name)
                for a in c.aliases
            ],
        )
        for c in repo.contributors
    ]
