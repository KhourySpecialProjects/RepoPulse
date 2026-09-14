"""GET /api/v1/admin/overview — instance-wide counts, health and sync freshness."""

from __future__ import annotations

import uuid

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.collection import Collection
from app.models.repo import Repo
from app.models.user import User


async def _collection_owned_by(db: AsyncSession, owner: User) -> Collection:
    slug = uuid.uuid4().hex[:8]
    collection = Collection(
        id=uuid.uuid4(),
        name=f"Collection {slug}",
        local_folder_name=f"collection-{slug}",
        owner_id=owner.id,
    )
    db.add(collection)
    await db.flush()
    return collection


async def _repo_in(
    db: AsyncSession, collection: Collection, *, health: str = "unknown"
) -> Repo:
    slug = uuid.uuid4().hex[:8]
    repo = Repo(
        id=uuid.uuid4(),
        collection_id=collection.id,
        github_url=f"https://github.com/acme/{slug}",
        name=f"repo-{slug}",
        health_status=health,
    )
    db.add(repo)
    await db.flush()
    return repo


async def test_overview_returns_counts_health_and_sync(
    test_client: AsyncClient, admin_auth_headers: dict[str, str]
) -> None:
    response = await test_client.get(
        "/api/v1/admin/overview", headers=admin_auth_headers
    )

    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"counts", "health", "sync", "generated_at"}
    assert body["counts"]["admins"] >= 1


async def test_overview_health_always_has_all_four_statuses(
    test_client: AsyncClient, admin_auth_headers: dict[str, str]
) -> None:
    response = await test_client.get(
        "/api/v1/admin/overview", headers=admin_auth_headers
    )

    assert set(response.json()["health"]) == {"green", "yellow", "red", "unknown"}


async def test_overview_returns_zeros_not_nulls_when_there_is_nothing(
    test_client: AsyncClient, admin_auth_headers: dict[str, str]
) -> None:
    response = await test_client.get(
        "/api/v1/admin/overview", headers=admin_auth_headers
    )

    body = response.json()
    assert body["counts"]["repos"] == 0
    assert body["counts"]["collections"] == 0
    assert body["health"]["green"] == 0
    assert body["sync"]["total"] == 0
    assert body["sync"]["most_recent_sync"] is None


async def test_overview_counts_a_collection_the_admin_holds_no_grant_to(
    test_client: AsyncClient,
    db_session: AsyncSession,
    admin_auth_headers: dict[str, str],
    test_user: User,
) -> None:
    """The point of the whole service: aggregates ignore permission scope.

    The collection is owned by an instructor and carries no CollectionAccess
    row for the admin. A permission-scoped implementation would report 0 repos.

    Weaker than it looks on its own — permission_service already returns
    everything for an admin — so it is paired with
    test_no_aggregate_method_accepts_a_user_id in the service tests, which is
    the structural guarantee.
    """
    collection = await _collection_owned_by(db_session, test_user)
    await _repo_in(db_session, collection, health="green")
    await _repo_in(db_session, collection, health="red")

    response = await test_client.get(
        "/api/v1/admin/overview", headers=admin_auth_headers
    )

    body = response.json()
    assert body["counts"]["repos"] == 2
    assert body["counts"]["collections"] == 1
    assert body["health"]["green"] == 1
    assert body["health"]["red"] == 1


async def test_overview_accepts_a_stale_window(
    test_client: AsyncClient, admin_auth_headers: dict[str, str]
) -> None:
    response = await test_client.get(
        "/api/v1/admin/overview?stale_after_days=30", headers=admin_auth_headers
    )

    assert response.status_code == 200
    assert response.json()["sync"]["stale_after_days"] == 30


async def test_overview_rejects_an_out_of_range_window(
    test_client: AsyncClient, admin_auth_headers: dict[str, str]
) -> None:
    for bad in ("0", "400", "-1"):
        response = await test_client.get(
            f"/api/v1/admin/overview?stale_after_days={bad}",
            headers=admin_auth_headers,
        )
        assert response.status_code == 422, bad
