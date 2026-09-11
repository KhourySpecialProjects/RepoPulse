from __future__ import annotations

import logging
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, get_db_session
from app.models.collection import Collection
from app.models.commit_classification import CommitClassification
from app.models.repo import Repo
from app.schemas.errors import ErrorResponse
from app.services.commit_classifier_service import CommitInput, build_classifier
from app.services.git_service import GitService
from app.services.llm.user_settings import resolve_llm_settings
from app.services.permission_service import can_access_collection

logger = logging.getLogger(__name__)

router = APIRouter()
_git_service = GitService()


# ── Pydantic response schemas ────────────────────────────────────────────────

class ScoredCommit(BaseModel):
    hash: str
    full_hash: str
    message: str
    author: str
    date: str
    # None when the LLM could not be reached or its answer could not be read.
    # An honest gap beats a fabricated "ok" that would be cached forever.
    score: str | None  # "good" | "ok" | "bad" | None
    from_cache: bool


class RepoCommitQuality(BaseModel):
    repo_id: str
    repo_name: str
    commits: list[ScoredCommit]
    cache_hits: int
    newly_scored: int


class CommitQualityResponse(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    repos: list[RepoCommitQuality]
    model_used: str
    repos_skipped: int
    total_cache_hits: int
    total_newly_scored: int


# ── Endpoint ─────────────────────────────────────────────────────────────────


def _commit_input(commit: dict) -> CommitInput:
    """Adapt a GitService commit dict for the classifier.

    needs_type is False: this endpoint shows message quality only, so asking
    for a type would spend tokens on an answer nothing here displays. The
    repo-level classify endpoint is what fills that column in.
    """
    return CommitInput(
        hash=commit["full_hash"],
        message=commit["message"],
        insertions=commit.get("insertions", 0),
        deletions=commit.get("deletions", 0),
        files_changed=commit.get("files_changed", 0),
        file_paths=commit.get("file_paths", ()),
        file_paths_truncated=commit.get("file_paths_truncated", False),
        diffstat_available=commit.get("diffstat_available", False),
        needs_type=False,
    )

@router.get(
    "/collections/{collection_id}/commit-quality",
    response_model=CommitQualityResponse,
    responses={
        403: {"model": ErrorResponse},
        404: {"model": ErrorResponse},
    },
)
async def get_commit_quality(
    collection_id: uuid.UUID,
    per_repo: int = Query(15, ge=5, le=25),
    db: AsyncSession = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user),
) -> CommitQualityResponse:
    """Score the most recent commit messages for every repo in a collection.

    Scores are cached in the DB by (repo_id, commit_hash). Only new commits
    (ones not seen before) require an LLM call.
    """
    user_uuid = uuid.UUID(current_user_id)

    collection = await db.get(Collection, collection_id)
    if collection is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Collection not found")
    if not await can_access_collection(db, user_uuid, collection_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    llm_cfg = await resolve_llm_settings(db, user_uuid)
    model_label = llm_cfg.label

    # Fetch repos
    repos_result = await db.execute(
        select(Repo)
        .where(Repo.collection_id == collection_id)
        .order_by(Repo.name)
    )
    repos = list(repos_result.scalars().all())

    # Gather recent commits for each cloned repo
    repo_commits: list[tuple[Repo, list[dict]]] = []
    repos_skipped = 0
    for repo in repos:
        if not repo.local_path:
            repos_skipped += 1
            continue
        try:
            commits = await _git_service.get_recent_commits(repo.local_path, limit=per_repo)
            if commits:
                repo_commits.append((repo, commits))
            else:
                repos_skipped += 1
        except Exception as exc:
            logger.warning("Could not read commits for repo %s: %s", repo.name, exc)
            repos_skipped += 1

    if not repo_commits:
        return CommitQualityResponse(
            repos=[], model_used=model_label, repos_skipped=repos_skipped,
            total_cache_hits=0, total_newly_scored=0,
        )

    # Load cached scores for all commit hashes in one query
    all_repo_ids = [repo.id for repo, _ in repo_commits]
    all_hashes = [c["full_hash"] for _, commits in repo_commits for c in commits]
    cached_result = await db.execute(
        select(CommitClassification).where(
            CommitClassification.repo_id.in_(all_repo_ids),
            CommitClassification.commit_hash.in_(all_hashes),
        )
    )
    cached_rows = cached_result.scalars().all()
    cache: dict[tuple[uuid.UUID, str], str | None] = {
        (row.repo_id, row.commit_hash): row.score for row in cached_rows
    }

    # Identify commits still needing a score. A row can exist carrying only a
    # commit_type — the classifier writes those — so "a row exists" is not the
    # same as "already scored", and testing membership would strand those
    # commits with a permanent null.
    uncached: list[tuple[int, int]] = []  # (repo_idx, commit_idx)
    for repo_idx, (repo, commits) in enumerate(repo_commits):
        for commit_idx, commit in enumerate(commits):
            if cache.get((repo.id, commit["full_hash"])) is None:
                uncached.append((repo_idx, commit_idx))

    # Score uncached messages with the LLM
    new_scores: dict[tuple[int, int], str] = {}
    if uncached:
        logger.info(
            "commit-quality: %d cache hits, scoring %d new messages via LLM for collection %s",
            len(all_hashes) - len(uncached), len(uncached), collection_id,
        )
        classifier = build_classifier(
            llm_cfg.provider, llm_cfg.model, llm_cfg.api_key, llm_cfg.ollama_url
        )
        results = await classifier.classify([
            _commit_input(repo_commits[repo_idx][1][commit_idx])
            for repo_idx, commit_idx in uncached
        ])

        rows_to_insert = []
        for (repo_idx, commit_idx), result in zip(uncached, results):
            # A None score means the call failed or the answer was unreadable.
            # Persisting it would cache a fabrication under this commit's hash
            # forever; leaving the gap lets the next request retry.
            if result.score is None:
                continue
            new_scores[(repo_idx, commit_idx)] = result.score
            repo, commits = repo_commits[repo_idx]
            rows_to_insert.append({
                "id": uuid.uuid4(),
                "repo_id": repo.id,
                "commit_hash": commits[commit_idx]["full_hash"],
                "score": result.score,
                "model_used": model_label,
            })

        if rows_to_insert:
            stmt = pg_insert(CommitClassification).values(rows_to_insert)
            # Not do_nothing: the conflicting row may be one the classifier
            # wrote with a type and no score, and that gap is exactly what this
            # insert is filling. Only the score columns are touched, so a
            # commit_type already on the row survives.
            stmt = stmt.on_conflict_do_update(
                constraint="uq_commit_classification_repo_hash",
                set_={
                    "score": stmt.excluded.score,
                    "model_used": stmt.excluded.model_used,
                    "scored_at": datetime.utcnow(),
                },
            )
            await db.execute(stmt)
            await db.commit()
    else:
        logger.info(
            "commit-quality: all %d commits served from cache for collection %s",
            len(all_hashes), collection_id,
        )

    # Assemble response
    result_repos: list[RepoCommitQuality] = []
    total_cache_hits = 0
    total_newly_scored = 0

    for repo_idx, (repo, commits) in enumerate(repo_commits):
        scored_commits = []
        repo_hits = 0
        repo_new = 0
        for commit_idx, commit in enumerate(commits):
            cached_score = cache.get((repo.id, commit["full_hash"]))
            if cached_score is not None:
                score = cached_score
                from_cache = True
                repo_hits += 1
            else:
                # None here means this run tried and failed — the commit is
                # neither a cache hit nor newly scored.
                score = new_scores.get((repo_idx, commit_idx))
                from_cache = False
                if score is not None:
                    repo_new += 1
            scored_commits.append(ScoredCommit(
                hash=commit["hash"],
                full_hash=commit["full_hash"],
                message=commit["message"],
                author=commit["author"],
                date=commit["date"],
                score=score,
                from_cache=from_cache,
            ))
        total_cache_hits += repo_hits
        total_newly_scored += repo_new
        result_repos.append(RepoCommitQuality(
            repo_id=str(repo.id),
            repo_name=repo.name,
            commits=scored_commits,
            cache_hits=repo_hits,
            newly_scored=repo_new,
        ))

    return CommitQualityResponse(
        repos=result_repos,
        model_used=model_label,
        repos_skipped=repos_skipped,
        total_cache_hits=total_cache_hits,
        total_newly_scored=total_newly_scored,
    )
