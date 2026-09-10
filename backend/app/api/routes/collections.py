from __future__ import annotations

import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, get_db_session
from app.models.collection import Collection
from app.models.repo import Repo
from app.models.user import User
from app.schemas.collections import (
    CollectionCommitActivity,
    CollectionCreate,
    CollectionRead,
    CollectionUpdate,
    CommitActivityPoint,
    PaginatedCollections,
)
from app.schemas.errors import ErrorResponse
from app.services.git_service import GitService
from app.services.permission_service import (
    can_access_collection,
    can_manage_collection,
    can_write_collection,
    get_accessible_collection_ids,
)

router = APIRouter()

_git_service = GitService()


def _collection_to_read(
    collection: Collection,
    repo_count: int = 0,
    health_green: int = 0,
    health_yellow: int = 0,
    health_red: int = 0,
    health_unknown: int = 0,
) -> CollectionRead:
    return CollectionRead(
        id=collection.id,
        name=collection.name,
        course_tag=collection.course_tag,
        semester_tag=collection.semester_tag,
        local_folder_name=collection.local_folder_name,
        owner_id=collection.owner_id,
        created_at=collection.created_at,
        updated_at=collection.updated_at,
        repo_count=repo_count,
        is_archived=collection.is_archived,
        health_green=health_green,
        health_yellow=health_yellow,
        health_red=health_red,
        health_unknown=health_unknown,
    )


# Subquery that counts repos per collection
_repo_count_subq = (
    select(func.count(Repo.id))
    .where(Repo.collection_id == Collection.id)
    .correlate(Collection)
    .scalar_subquery()
)


def _health_count_subq(health_status: str):
    return (
        select(func.count(Repo.id))
        .where(Repo.collection_id == Collection.id, Repo.health_status == health_status)
        .correlate(Collection)
        .scalar_subquery()
    )


@router.get(
    "/collections",
    response_model=PaginatedCollections,
)
async def list_collections(
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    include_archived: bool = Query(False),
    db: AsyncSession = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user),
) -> PaginatedCollections:
    user_uuid = uuid.UUID(current_user_id)

    accessible_ids = await get_accessible_collection_ids(db, user_uuid)

    count_q = select(func.count()).select_from(Collection).where(
        Collection.id.in_(accessible_ids)
    )
    if not include_archived:
        count_q = count_q.where(Collection.is_archived == False)  # noqa: E712
    count_result = await db.execute(count_q)
    total = count_result.scalar_one()

    list_q = (
        select(
            Collection,
            _repo_count_subq.label("repo_count"),
            _health_count_subq("green").label("health_green"),
            _health_count_subq("yellow").label("health_yellow"),
            _health_count_subq("red").label("health_red"),
            _health_count_subq("unknown").label("health_unknown"),
        )
        .where(Collection.id.in_(accessible_ids))
        .order_by(Collection.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    if not include_archived:
        list_q = list_q.where(Collection.is_archived == False)  # noqa: E712
    result = await db.execute(list_q)
    rows = result.all()

    return PaginatedCollections(
        items=[_collection_to_read(
            row.Collection,
            row.repo_count,
            row.health_green,
            row.health_yellow,
            row.health_red,
            row.health_unknown,
        ) for row in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.post(
    "/collections",
    response_model=CollectionRead,
    status_code=status.HTTP_201_CREATED,
    responses={403: {"model": ErrorResponse}},
)
async def create_collection(
    body: CollectionCreate,
    db: AsyncSession = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user),
) -> CollectionRead:
    owner_uuid = uuid.UUID(current_user_id)

    # Only instructors and admins can create collections
    user = await db.get(User, owner_uuid)
    if user is None or user.role not in ("instructor", "admin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only instructors and admins can create collections",
        )

    collection = Collection(
        name=body.name,
        course_tag=body.course_tag,
        semester_tag=body.semester_tag,
        local_folder_name=body.local_folder_name,
        owner_id=owner_uuid,
    )
    db.add(collection)
    await db.commit()
    await db.refresh(collection)
    return _collection_to_read(collection)


@router.get(
    "/collections/{collection_id}",
    response_model=CollectionRead,
    responses={404: {"model": ErrorResponse}},
)
async def get_collection(
    collection_id: uuid.UUID,
    db: AsyncSession = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user),
) -> CollectionRead:
    user_uuid = uuid.UUID(current_user_id)

    result = await db.execute(
        select(
            Collection,
            _repo_count_subq.label("repo_count"),
            _health_count_subq("green").label("health_green"),
            _health_count_subq("yellow").label("health_yellow"),
            _health_count_subq("red").label("health_red"),
            _health_count_subq("unknown").label("health_unknown"),
        )
        .where(Collection.id == collection_id)
    )
    row = result.one_or_none()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Collection not found",
        )

    has_access = await can_access_collection(db, user_uuid, collection_id)
    if not has_access:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Collection not found",
        )

    return _collection_to_read(row.Collection, row.repo_count, row.health_green, row.health_yellow, row.health_red, row.health_unknown)


@router.patch(
    "/collections/{collection_id}",
    response_model=CollectionRead,
    responses={403: {"model": ErrorResponse}, 404: {"model": ErrorResponse}},
)
async def update_collection(
    collection_id: uuid.UUID,
    body: CollectionUpdate,
    db: AsyncSession = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user),
) -> CollectionRead:
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

    if not await can_write_collection(db, user_uuid, collection_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to update this collection",
        )

    update_data = body.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(collection, field, value)

    await db.commit()
    await db.refresh(collection)
    return _collection_to_read(collection)


@router.delete(
    "/collections/{collection_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_model=None,
    responses={403: {"model": ErrorResponse}, 404: {"model": ErrorResponse}},
)
async def delete_collection(
    collection_id: uuid.UUID,
    db: AsyncSession = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user),
) -> None:
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

    if not await can_manage_collection(db, user_uuid, collection_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the collection owner or an admin can delete this collection",
        )

    await db.delete(collection)
    await db.commit()


@router.get(
    "/collections/{collection_id}/commit-activity",
    response_model=CollectionCommitActivity,
    responses={404: {"model": ErrorResponse}},
)
async def get_collection_commit_activity(
    collection_id: uuid.UUID,
    db: AsyncSession = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user),
) -> CollectionCommitActivity:
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
        select(Repo).where(
            Repo.collection_id == collection_id,
            Repo.local_path.is_not(None),
        )
    )
    repos = result.scalars().all()

    seen_hashes: set[str] = set()
    date_counts: dict[str, int] = {}

    for repo in repos:
        try:
            commits = await _git_service.parse_commits(repo.local_path)
        except Exception:
            continue

        for commit in commits:
            commit_hash = commit.get("hash", "")
            if commit_hash in seen_hashes:
                continue
            seen_hashes.add(commit_hash)

            raw_date = commit.get("date")
            if raw_date is None:
                continue
            date_str = raw_date.strftime("%Y-%m-%d") if hasattr(raw_date, "strftime") else str(raw_date)[:10]
            if not date_str:
                continue

            date_counts[date_str] = date_counts.get(date_str, 0) + 1

    activity = [
        CommitActivityPoint(date=date, count=count)
        for date, count in sorted(date_counts.items())
    ]
    return CollectionCommitActivity(activity=activity)


async def _sync_all_repos(collection_id: uuid.UUID) -> None:
    """Background task: fetch all repos in a collection."""
    from app.db.database import async_session_maker

    async with async_session_maker() as db:
        result = await db.execute(
            select(Repo).where(Repo.collection_id == collection_id)
        )
        repos = result.scalars().all()
        for repo in repos:
            if repo.local_path:
                try:
                    await _git_service.fetch_repo(repo.local_path)
                except Exception:
                    pass


@router.post(
    "/collections/{collection_id}/sync",
    status_code=status.HTTP_202_ACCEPTED,
    responses={403: {"model": ErrorResponse}, 404: {"model": ErrorResponse}},
)
async def sync_collection(
    collection_id: uuid.UUID,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user),
) -> dict:
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

    background_tasks.add_task(_sync_all_repos, collection_id)
    return {"detail": "Sync started", "collection_id": str(collection_id)}
