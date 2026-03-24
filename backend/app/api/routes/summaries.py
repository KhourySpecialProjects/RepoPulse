from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, get_db_session
from app.models.contributor import Contributor
from app.models.repo import Repo
from app.models.summary import Summary
from app.schemas.errors import ErrorResponse
from app.schemas.summaries import GenerateSummaryRequest, SummaryRead
from app.services.git_service import GitService
from app.services.health_service import HealthService
from app.models.app_settings import AppSettings
from app.services.llm import get_llm_service
from app.services.summary_service import SummaryService

router = APIRouter()

_git_service = GitService()
_health_service = HealthService()


def _summary_to_read(summary: Summary) -> SummaryRead:
    return SummaryRead(
        id=summary.id,
        repo_id=summary.repo_id,
        contributor_id=summary.contributor_id,
        summary_type=summary.summary_type,
        content=summary.content,
        model_used=summary.model_used,
        generated_at=summary.generated_at,
    )


@router.post(
    "/summaries/generate",
    response_model=SummaryRead,
    status_code=status.HTTP_201_CREATED,
    responses={
        400: {"model": ErrorResponse},
        404: {"model": ErrorResponse},
    },
)
async def generate_summary(
    body: GenerateSummaryRequest,
    db: AsyncSession = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user),
) -> SummaryRead:
    user_uuid = uuid.UUID(current_user_id)
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

    llm = get_llm_service(provider, model, api_key, ollama_url)
    summary_svc = SummaryService(llm=llm)
    model_used = f"ollama/{model}" if provider == "ollama" else model

    if body.summary_type == "repo_overview":
        if body.repo_id is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="repo_id is required for repo_overview summaries",
            )
        repo = await db.get(Repo, body.repo_id)
        if repo is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Repo not found",
            )

        commits: list[dict] = []
        if repo.local_path:
            try:
                commits = await _git_service.parse_commits(repo.local_path)
            except Exception:
                pass

        repo_data = {
            "name": repo.name,
            "github_url": repo.github_url,
            "health_status": repo.health_status,
            "health_score": repo.health_score or {},
            "commits": commits,
            "contributors": [
                {"display_name": c.display_name} for c in repo.contributors
            ],
        }
        content = await summary_svc.generate_repo_overview(repo_data)

        summary = Summary(
            repo_id=body.repo_id,
            contributor_id=None,
            summary_type="repo_overview",
            content=content,
            model_used=model_used,
        )

    elif body.summary_type == "contributor_activity":
        if body.contributor_id is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="contributor_id is required for contributor_activity summaries",
            )
        contributor = await db.get(Contributor, body.contributor_id)
        if contributor is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Contributor not found",
            )

        repo = await db.get(Repo, contributor.repo_id)
        commits_for_contributor: list[dict] = []
        if repo and repo.local_path:
            try:
                all_commits = await _git_service.parse_commits(repo.local_path)
                contributor_emails = {a.git_email for a in contributor.aliases}
                commits_for_contributor = [
                    c for c in all_commits
                    if c["author_email"].lower() in contributor_emails
                ]
            except Exception:
                pass

        contributor_data = {
            "display_name": contributor.display_name,
            "repo_name": repo.name if repo else "Unknown",
            "commits": commits_for_contributor,
            "aliases": [
                {"git_name": a.git_name, "git_email": a.git_email}
                for a in contributor.aliases
            ],
        }
        content = await summary_svc.generate_contributor_activity(contributor_data)

        summary = Summary(
            repo_id=contributor.repo_id,
            contributor_id=body.contributor_id,
            summary_type="contributor_activity",
            content=content,
            model_used=model_used,
        )

    elif body.summary_type == "health_explanation":
        if body.repo_id is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="repo_id is required for health_explanation summaries",
            )
        repo = await db.get(Repo, body.repo_id)
        if repo is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Repo not found",
            )
        if not repo.health_score:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Health data not available. Sync the repo first.",
            )

        health_data = {"repo_name": repo.name, **repo.health_score}
        content = await summary_svc.generate_health_explanation(health_data)

        summary = Summary(
            repo_id=body.repo_id,
            contributor_id=None,
            summary_type="health_explanation",
            content=content,
            model_used=model_used,
        )
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown summary_type: {body.summary_type}",
        )

    db.add(summary)
    await db.commit()
    await db.refresh(summary)
    return _summary_to_read(summary)


@router.get(
    "/repos/{repo_id}/summaries",
    response_model=list[SummaryRead],
    responses={404: {"model": ErrorResponse}},
)
async def get_repo_summaries(
    repo_id: uuid.UUID,
    db: AsyncSession = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user),
) -> list[SummaryRead]:
    repo = await db.get(Repo, repo_id)
    if repo is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Repo not found",
        )
    result = await db.execute(
        select(Summary)
        .where(Summary.repo_id == repo_id)
        .order_by(Summary.generated_at.desc())
    )
    summaries = result.scalars().all()
    return [_summary_to_read(s) for s in summaries]


@router.get(
    "/contributors/{contributor_id}/summaries",
    response_model=list[SummaryRead],
    responses={404: {"model": ErrorResponse}},
)
async def get_contributor_summaries(
    contributor_id: uuid.UUID,
    db: AsyncSession = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user),
) -> list[SummaryRead]:
    contributor = await db.get(Contributor, contributor_id)
    if contributor is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Contributor not found",
        )
    result = await db.execute(
        select(Summary)
        .where(Summary.contributor_id == contributor_id)
        .order_by(Summary.generated_at.desc())
    )
    summaries = result.scalars().all()
    return [_summary_to_read(s) for s in summaries]
