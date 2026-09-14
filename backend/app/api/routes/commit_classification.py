"""Repo-level commit classification.

Fills the `commit_type` column that the repo Commits table renders. Commits are
parsed live from the clone, diffed against the cached sidecar rows, resolved by
the rules prefilter where possible, and only the remainder is sent to the LLM.

Three properties are load-bearing and each has a test:

* **Nothing is ever fabricated.** A commit the model could not answer for is
  left with no row, so a later run retries it. Persisting a guess would cache
  it under an immutable hash forever.
* **A row is not all-or-nothing.** The collection-level quality endpoint writes
  rows carrying a score and no type. Those commits are *pending* here, and the
  upsert must fill the type without disturbing the score.
* **Work is persisted as it lands.** One transaction held open across minutes
  of LLM calls pins an xmin horizon, and `uvicorn --reload` will happily kill a
  long run mid-flight in dev.
"""
from __future__ import annotations

import logging
import time
import uuid
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, get_db_session
from app.models.commit_classification import CommitClassification
from app.models.repo import Repo
from app.schemas.errors import ErrorResponse
from app.services.commit_classifier_service import (
    BATCH_SIZE,
    MAX_CONCURRENCY,
    WAVE_SIZE,
    CommitInput,
    build_classifier,
    classify_by_rules,
)
from app.services.git_service import GitService
from app.services.llm.user_settings import resolve_llm_settings
from app.services.permission_service import can_access_collection

logger = logging.getLogger(__name__)

router = APIRouter()
_git_service = GitService()

# Above this many *LLM-bound* commits, an unconfirmed request previews instead
# of working. Deliberately not measured against the unclassified count: the
# rules prefilter is free, so a docs-heavy repo with 400 unclassified commits
# and 20 real ones should not be gated behind a dialog.
PREVIEW_THRESHOLD = 200

# A hard ceiling that applies even to a confirmed run, so no single request can
# sit for twenty minutes. The response reports `remaining` and the caller loops.
MAX_LLM_PER_REQUEST = 500

# Written to `model_used` for rows the prefilter decided. Recording a model id
# for a call that never happened would be a lie; the version suffix makes a
# future rules change sweepable.
RULES_MODEL = "rules:v1"

# Repos with a run in progress. Sufficient because the container runs a single
# uvicorn process with no --workers; adding workers silently disables this.
# A Postgres advisory lock is *not* the answer: the transaction-scoped variant
# releases at the first wave commit, and the session-scoped variant leaks onto
# a pooled connection if the request dies, making the repo permanently stuck.
_in_flight: set[uuid.UUID] = set()


class ClassifyCommitsRequest(BaseModel):
    confirm: bool = False


class ClassifyCommitsResponse(BaseModel):
    # `model_used` collides with Pydantic's protected `model_` namespace.
    model_config = ConfigDict(protected_namespaces=())

    status: Literal["preview", "completed"]
    total_commits: int
    already_classified: int
    pending: int
    resolvable_by_rules: int
    needs_llm: int
    classified_by_rules: int
    classified_by_llm: int
    classified: int
    #: The model was asked and returned nothing usable. Retryable.
    skipped: int
    #: Deferred, not failed — either awaiting confirmation or past the
    #: per-request cap. Kept separate from `skipped` so the UI can tell the
    #: user whether clicking again will help.
    remaining: int
    threshold: int
    model_used: str


def _commit_input(commit: dict, *, needs_score: bool) -> CommitInput:
    return CommitInput(
        hash=commit["hash"],
        message=commit["message"],
        insertions=commit.get("insertions", 0),
        deletions=commit.get("deletions", 0),
        files_changed=commit.get("files_changed", 0),
        file_paths=tuple(commit.get("file_paths", ())),
        file_paths_truncated=commit.get("file_paths_truncated", False),
        # False, not True: a commit whose diff could not be read reports the
        # same zeros as an empty one, and only the flag distinguishes them.
        diffstat_available=commit.get("diffstat_available", False),
        needs_type=True,
        # Asking for a score costs nothing — the prompt returns both dimensions
        # regardless — but sending one back would overwrite a score this repo
        # already paid for on the Collections page.
        needs_score=needs_score,
    )


def _row(repo_id: uuid.UUID, commit_hash: str, commit_type, score, model: str) -> dict:
    return {
        "id": uuid.uuid4(),
        "repo_id": repo_id,
        "commit_hash": commit_hash,
        "commit_type": commit_type,
        "score": score,
        "model_used": model,
    }


async def _persist(db: AsyncSession, rows: list[dict]) -> bool:
    """Upsert a batch and commit it. Returns False if the write failed.

    `on_conflict_do_update` rather than `do_nothing`: a row already exists for
    every commit the Collections page has scored, and `do_nothing` would refuse
    to classify exactly those, forever.

    Each dimension is COALESCEd so a NULL never clobbers a value that is
    already there. `model_used` and `scored_at` are deliberately absent from
    the update — both columns serve two independently-written dimensions, so
    rewriting them would reattribute an existing score to whatever just decided
    the type. They are still set on genuine inserts via `values()`.
    """
    if not rows:
        return True

    # A repeated key in one statement raises 21000 and aborts the whole batch;
    # sorting gives overlapping runs a deterministic lock order.
    unique = {r["commit_hash"]: r for r in rows}
    ordered = [unique[h] for h in sorted(unique)]

    stmt = pg_insert(CommitClassification).values(ordered)
    stmt = stmt.on_conflict_do_update(
        constraint="uq_commit_classification_repo_hash",
        set_={
            "commit_type": func.coalesce(
                stmt.excluded.commit_type, CommitClassification.commit_type
            ),
            "score": func.coalesce(
                stmt.excluded.score, CommitClassification.score
            ),
        },
    )

    try:
        await db.execute(stmt)
        await db.commit()
        return True
    except SQLAlchemyError as exc:
        # Without the rollback the session stays in a failed state and every
        # later wave raises PendingRollbackError — losing answers already paid
        # for and reporting a misleading zero.
        logger.warning("classify: persisting %d rows failed: %s", len(ordered), exc)
        await db.rollback()
        return False


@router.post(
    "/repos/{repo_id}/commits/classify",
    response_model=ClassifyCommitsResponse,
    responses={
        400: {"model": ErrorResponse},
        404: {"model": ErrorResponse},
        409: {"model": ErrorResponse},
    },
)
async def classify_repo_commits(
    repo_id: uuid.UUID,
    body: Optional[ClassifyCommitsRequest] = None,
    db: AsyncSession = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user),
) -> ClassifyCommitsResponse:
    """Classify every unclassified commit in a repo.

    Returns 200 in both states: `status="preview"` means nothing was written
    and the caller should confirm; `status="completed"` means the work in this
    request is done, with `remaining` non-zero if the cap was hit.
    """
    confirm = bool(body and body.confirm)
    user_uuid = uuid.UUID(current_user_id)

    repo = await db.get(Repo, repo_id)
    if repo is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Repo not found"
        )
    if not await can_access_collection(db, user_uuid, repo.collection_id):
        # 404 rather than 403, matching every other repo route: collection
        # membership must not be inferable from the status code.
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Repo not found"
        )
    if not repo.local_path:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Repo has no local path. Add and sync the repo first.",
        )

    if repo_id in _in_flight:
        # Must stay a 409. main.py rewrites every 404 body to "Resource not
        # found", which would tell the user their repo is missing while their
        # classification is running perfectly well.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "Classification is already running for this repo; "
                "results will appear when it finishes."
            ),
        )

    # Read before the first commit: attribute access after one would re-fetch
    # if expire_on_commit were ever turned back on.
    local_path = repo.local_path
    repo_name = repo.name

    _in_flight.add(repo_id)
    try:
        try:
            t0 = time.perf_counter()
            all_commits = await _git_service.parse_commits(local_path)
            logger.debug(
                "classify: parsed %d commits in %.2fs — %s",
                len(all_commits), time.perf_counter() - t0, repo_name,
            )
        except Exception as exc:
            logger.exception("classify: parse_commits failed for %s", local_path)
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Could not read commits: {exc}",
            )

        cached_rows = (
            await db.execute(
                select(
                    CommitClassification.commit_hash,
                    CommitClassification.commit_type,
                    CommitClassification.score,
                ).where(CommitClassification.repo_id == repo_id)
            )
        ).all()
        cached = {r.commit_hash: (r.commit_type, r.score) for r in cached_rows}

        # A commit is pending if it has no *type*. Testing row presence would
        # strand every commit the Collections page has already scored.
        pending = [
            c for c in all_commits if cached.get(c["hash"], (None, None))[0] is None
        ]
        total_commits = len(all_commits)
        already_classified = total_commits - len(pending)

        llm_cfg = await resolve_llm_settings(db, user_uuid)

        # The prefilter runs before the preview decision so the threshold is
        # measured against real cost.
        rule_hits: list[tuple[dict, str]] = []
        llm_bound: list[dict] = []
        for commit in pending:
            verdict = classify_by_rules(
                commit["message"],
                files_changed=commit.get("files_changed", 0),
                insertions=commit.get("insertions", 0),
                deletions=commit.get("deletions", 0),
                file_paths=commit.get("file_paths", ()),
                file_paths_truncated=commit.get("file_paths_truncated", False),
                diffstat_available=commit.get("diffstat_available", False),
            )
            if verdict is not None:
                rule_hits.append((commit, verdict))
            else:
                llm_bound.append(commit)

        def _response(
            state: str,
            *,
            by_rules: int = 0,
            by_llm: int = 0,
            skipped: int = 0,
            remaining: int = 0,
        ) -> ClassifyCommitsResponse:
            return ClassifyCommitsResponse(
                status=state,
                total_commits=total_commits,
                already_classified=already_classified,
                pending=len(pending),
                resolvable_by_rules=len(rule_hits),
                needs_llm=len(llm_bound),
                classified_by_rules=by_rules,
                classified_by_llm=by_llm,
                classified=by_rules + by_llm,
                skipped=skipped,
                remaining=remaining,
                threshold=PREVIEW_THRESHOLD,
                model_used=llm_cfg.label,
            )

        if not pending:
            return _response("completed")

        if len(llm_bound) > PREVIEW_THRESHOLD and not confirm:
            # Writes nothing at all, not even the free rule hits — "a preview
            # changes nothing" should be literally true.
            return _response("preview", remaining=len(pending))

        classified_by_rules = 0
        if rule_hits:
            written = await _persist(
                db,
                [
                    _row(repo_id, c["hash"], verdict, None, RULES_MODEL)
                    for c, verdict in rule_hits
                ],
            )
            if written:
                classified_by_rules = len(rule_hits)

        to_process = llm_bound[:MAX_LLM_PER_REQUEST]
        remaining = len(llm_bound) - len(to_process)

        classified_by_llm = 0
        if to_process:
            logger.info(
                "classify: %s — %d by rules, %d to %s in waves of %d "
                "(chunk %d, concurrency %d)",
                repo_name, len(rule_hits), len(to_process),
                llm_cfg.label, WAVE_SIZE, BATCH_SIZE, MAX_CONCURRENCY,
            )
            # Built once: the adapter caches its HTTP client, and rebuilding it
            # per wave would re-handshake every 240 commits.
            classifier = build_classifier(
                llm_cfg.provider, llm_cfg.model, llm_cfg.api_key, llm_cfg.ollama_url
            )

            for start in range(0, len(to_process), WAVE_SIZE):
                wave = to_process[start:start + WAVE_SIZE]
                results = await classifier.classify(
                    [
                        _commit_input(
                            c,
                            needs_score=cached.get(c["hash"], (None, None))[1] is None,
                        )
                        for c in wave
                    ]
                )

                rows: list[dict] = []
                typed = 0
                for commit, result in zip(wave, results):
                    if result.commit_type is None and result.score is None:
                        continue  # nothing usable — leave the gap for a retry
                    rows.append(
                        _row(
                            repo_id,
                            commit["hash"],
                            result.commit_type,
                            result.score,
                            llm_cfg.label,
                        )
                    )
                    if result.commit_type is not None:
                        typed += 1

                if await _persist(db, rows):
                    classified_by_llm += typed

        return _response(
            "completed",
            by_rules=classified_by_rules,
            by_llm=classified_by_llm,
            skipped=len(to_process) - classified_by_llm,
            remaining=remaining,
        )
    finally:
        # Runs on CancelledError too, so a disconnected client cannot strand
        # the repo in a permanently-locked state.
        _in_flight.discard(repo_id)
