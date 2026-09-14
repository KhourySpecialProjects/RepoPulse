from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, get_db_session
from app.models.contributor import Contributor
from app.schemas.contributors import (
    AliasRead,
    ContributorRead,
    ContributorUpdate,
    MergeContributorsRequest,
    UnmergeContributorsResponse,
)
from app.schemas.errors import ErrorResponse

from app.services import contributor_service

router = APIRouter()


def _contributor_to_read(contributor: Contributor) -> ContributorRead:
    return ContributorRead.model_validate(contributor)


@router.get(
    "/contributors/{contributor_id}",
    response_model=ContributorRead,
    responses={404: {"model": ErrorResponse}},
)
async def get_contributor(
    contributor_id: uuid.UUID,
    db: AsyncSession = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user),
) -> ContributorRead:
    contributor = await db.get(Contributor, contributor_id)
    if contributor is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Contributor not found",
        )
    return _contributor_to_read(contributor)


@router.put(
    "/contributors/{contributor_id}",
    response_model=ContributorRead,
    responses={404: {"model": ErrorResponse}},
)
async def update_contributor(
    contributor_id: uuid.UUID,
    body: ContributorUpdate,
    db: AsyncSession = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user),
) -> ContributorRead:
    contributor = await db.get(Contributor, contributor_id)
    if contributor is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Contributor not found",
        )
    contributor.display_name = body.display_name
    await db.commit()
    await db.refresh(contributor)
    return _contributor_to_read(contributor)


@router.post(
    "/contributors/merge",
    response_model=ContributorRead,
    responses={
        400: {"model": ErrorResponse},
        404: {"model": ErrorResponse},
    },
)
async def merge_contributors(
    body: MergeContributorsRequest,
    db: AsyncSession = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user),
) -> ContributorRead:
    contributor = await contributor_service.merge_contributors(
        db, body.contributor_ids, body.display_name, uuid.UUID(current_user_id)
    )
    return _contributor_to_read(contributor)


@router.post(
    "/contributors/{contributor_id}/unmerge",
    response_model=UnmergeContributorsResponse,
    responses={403: {"model": ErrorResponse}, 404: {"model": ErrorResponse}, 409: {"model": ErrorResponse}},
)
async def unmerge_contributor(
    contributor_id: uuid.UUID,
    db: AsyncSession = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user),
) -> UnmergeContributorsResponse:
    restored = await contributor_service.unmerge_contributor(db, contributor_id, uuid.UUID(current_user_id))
    return UnmergeContributorsResponse(contributors=[_contributor_to_read(c) for c in restored])


@router.get(
    "/contributors/{contributor_id}/aliases",
    response_model=list[AliasRead],
    responses={404: {"model": ErrorResponse}},
)
async def get_contributor_aliases(
    contributor_id: uuid.UUID,
    db: AsyncSession = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user),
) -> list[AliasRead]:
    contributor = await db.get(Contributor, contributor_id)
    if contributor is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Contributor not found",
        )
    return [
        AliasRead(id=a.id, git_email=a.git_email, git_name=a.git_name)
        for a in contributor.aliases
    ]
