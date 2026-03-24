from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, update as sa_update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, get_db_session
from app.models.contributor import Contributor
from app.models.contributor_alias import ContributorAlias
from app.schemas.contributors import (
    AliasRead,
    ContributorRead,
    ContributorUpdate,
    MergeContributorsRequest,
)
from app.schemas.errors import ErrorResponse

router = APIRouter()


def _contributor_to_read(contributor: Contributor) -> ContributorRead:
    return ContributorRead(
        id=contributor.id,
        display_name=contributor.display_name,
        repo_id=contributor.repo_id,
        created_at=contributor.created_at,
        aliases=[
            AliasRead(id=a.id, git_email=a.git_email, git_name=a.git_name)
            for a in contributor.aliases
        ],
    )


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
    if len(body.contributor_ids) < 2:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least 2 contributor IDs required to merge",
        )

    contributors: list[Contributor] = []
    for cid in body.contributor_ids:
        c = await db.get(Contributor, cid)
        if c is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Contributor {cid} not found",
            )
        contributors.append(c)

    # Use first as canonical; re-parent all aliases via direct SQL to avoid
    # SQLAlchemy nullifying contributor_id during the relationship flush
    primary = contributors[0]
    primary.display_name = body.display_name

    for secondary in contributors[1:]:
        # Sum stats into primary
        primary.commit_count += secondary.commit_count
        primary.total_insertions += secondary.total_insertions
        primary.total_deletions += secondary.total_deletions
        if secondary.last_commit_at and (
            primary.last_commit_at is None
            or secondary.last_commit_at > primary.last_commit_at
        ):
            primary.last_commit_at = secondary.last_commit_at

        # Raw SQL UPDATE moves aliases in the DB before ORM processes the delete.
        # flush() pushes it to the DB within the transaction so that refresh()
        # reloads secondary with an empty aliases list, preventing SQLAlchemy
        # from trying to NULL out contributor_id when it processes the delete.
        await db.execute(
            sa_update(ContributorAlias)
            .where(ContributorAlias.contributor_id == secondary.id)
            .values(contributor_id=primary.id)
        )
        await db.flush()
        await db.refresh(secondary)
        await db.delete(secondary)

    await db.commit()
    await db.refresh(primary)
    return _contributor_to_read(primary)


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
