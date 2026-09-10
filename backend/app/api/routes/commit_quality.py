from __future__ import annotations

import json
import logging
import re
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, get_db_session
from app.models.app_settings import AppSettings
from app.models.collection import Collection
from app.models.commit_classification import CommitClassification
from app.models.repo import Repo
from app.schemas.errors import ErrorResponse
from app.services.git_service import GitService
from app.services.llm import get_llm_service
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
    score: str         # "good" | "ok" | "bad"
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


# ── LLM scoring ─────────────────────────────────────────────────────────────

_SYSTEM = (
    "You evaluate git commit messages for clarity and informativeness. "
    "You return only valid JSON — no prose, no markdown fences."
)

_SCORE_CRITERIA = """Score each commit message as exactly one of: "good", "ok", or "bad".

Criteria:
\u2022 "good"  \u2013 clearly describes what changed and/or why (e.g. "Fix null pointer in UserService when email is missing", "Add JWT refresh token support")
\u2022 "ok"    \u2013 somewhat descriptive but vague (e.g. "Fix auth bug", "Update styles", "Refactor login page")
\u2022 "bad"   \u2013 uninformative or placeholder (e.g. "fix", "update", "wip", "done", ".", "asdf", "commit", "changes", "temp")

Return a JSON array of objects. Each object must have exactly two keys: "i" (the integer index) and "s" (the score string).
Example: [{"i":0,"s":"bad"},{"i":1,"s":"good"}]

Commit messages to score:
"""


async def _score_messages(
    messages: list[str],
    llm_provider: str,
    llm_model: str,
    api_key: str | None,
    ollama_url: str | None,
) -> list[str]:
    """Return a score string for each message, in the same order. Falls back to 'ok' on any error."""
    if not messages:
        return []

    numbered = "\n".join(f'{i}. "{msg}"' for i, msg in enumerate(messages))
    prompt = _SCORE_CRITERIA + numbered

    try:
        llm = get_llm_service(llm_provider, llm_model, api_key, ollama_url)
        raw = await llm.generate(prompt, system=_SYSTEM, max_tokens=len(messages) * 25 + 64)
    except Exception as exc:
        logger.warning("commit quality LLM call failed: %s", exc)
        return ["ok"] * len(messages)

    cleaned = re.sub(r"```[a-z]*\n?", "", raw).strip()
    try:
        data: list[dict[str, Any]] = json.loads(cleaned)
        index_to_score = {int(item["i"]): str(item["s"]) for item in data}
        valid = {"good", "ok", "bad"}
        return [
            index_to_score.get(i, "ok") if index_to_score.get(i, "ok") in valid else "ok"
            for i in range(len(messages))
        ]
    except Exception as exc:
        logger.warning("commit quality JSON parse failed (%s) \u2014 raw: %.200s", exc, raw)
        return ["ok"] * len(messages)


# ── Endpoint ─────────────────────────────────────────────────────────────────

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

    # Load LLM settings for this user
    settings_result = await db.execute(
        select(AppSettings).where(AppSettings.user_id == user_uuid)
    )
    user_settings = settings_result.scalar_one_or_none()
    if user_settings:
        provider = user_settings.llm_provider or "anthropic"
        model = user_settings.llm_model or "claude-sonnet-4-20250514"
        api_key = user_settings.anthropic_api_key or None
        ollama_url = user_settings.ollama_base_url or None
    else:
        provider = "anthropic"
        model = "claude-sonnet-4-20250514"
        api_key = None
        ollama_url = None

    model_label = f"ollama/{model}" if provider == "ollama" else model

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
    cache: dict[tuple[uuid.UUID, str], str] = {
        (row.repo_id, row.commit_hash): row.score for row in cached_rows
    }

    # Identify uncached messages that need LLM scoring
    uncached: list[tuple[int, int, str]] = []  # (repo_idx, commit_idx, message)
    for repo_idx, (repo, commits) in enumerate(repo_commits):
        for commit_idx, commit in enumerate(commits):
            key = (repo.id, commit["full_hash"])
            if key not in cache:
                uncached.append((repo_idx, commit_idx, commit["message"]))

    # Score uncached messages with LLM (single batch call)
    new_scores: dict[tuple[int, int], str] = {}
    if uncached:
        messages = [msg for _, _, msg in uncached]
        logger.info(
            "commit-quality: %d cache hits, scoring %d new messages via LLM for collection %s",
            len(all_hashes) - len(uncached), len(uncached), collection_id,
        )
        llm_scores = await _score_messages(messages, provider, model, api_key, ollama_url)
        for (repo_idx, commit_idx, _), score in zip(uncached, llm_scores):
            new_scores[(repo_idx, commit_idx)] = score

        # Persist new scores to DB (ignore conflicts — another request may have scored the same commit)
        rows_to_insert = []
        for (repo_idx, commit_idx, _), score in zip(uncached, llm_scores):
            repo, commits = repo_commits[repo_idx]
            rows_to_insert.append({
                "id": uuid.uuid4(),
                "repo_id": repo.id,
                "commit_hash": commits[commit_idx]["full_hash"],
                "score": score,
                "model_used": model_label,
            })
        if rows_to_insert:
            stmt = pg_insert(CommitClassification).values(rows_to_insert)
            stmt = stmt.on_conflict_do_nothing(constraint="uq_commit_classification_repo_hash")
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
            key = (repo.id, commit["full_hash"])
            if key in cache:
                score = cache[key]
                from_cache = True
                repo_hits += 1
            else:
                score = new_scores.get((repo_idx, commit_idx), "ok")
                from_cache = False
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
