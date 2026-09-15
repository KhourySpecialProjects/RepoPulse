"""GET /api/v1/admin/growth — row accumulation, for load and capacity planning.

Reframed deliberately: this is not an engagement metric. It answers "how fast
is this instance accumulating rows", which is what an operator needs to size a
disk and a database. Whether students are productive is a different question
asked on a different page.

Every figure here is a count of rows whose creation timestamp falls inside a
real interval. Nothing is extrapolated, because nothing in the schema would
support it.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.collection import Collection
from app.models.repo import Repo
from app.models.summary import Summary
from app.models.user import User


def _ago(**kwargs: float) -> datetime:
    return datetime.now(timezone.utc) - timedelta(**kwargs)


async def _collection(
    db: AsyncSession, owner: User, *, created_at: datetime | None = None
) -> Collection:
    slug = uuid.uuid4().hex[:8]
    collection = Collection(
        id=uuid.uuid4(),
        name=f"Collection {slug}",
        local_folder_name=f"coll-{slug}",
        owner_id=owner.id,
    )
    if created_at is not None:
        collection.created_at = created_at
    db.add(collection)
    await db.flush()
    return collection


async def _repo(
    db: AsyncSession, collection: Collection, *, created_at: datetime | None = None
) -> Repo:
    slug = uuid.uuid4().hex[:8]
    repo = Repo(
        id=uuid.uuid4(),
        collection_id=collection.id,
        github_url=f"https://github.com/acme/{slug}",
        name=f"repo-{slug}",
    )
    if created_at is not None:
        repo.created_at = created_at
    db.add(repo)
    await db.flush()
    return repo


def _delta(body: dict, metric: str) -> dict:
    return next(item for item in body["deltas"] if item["metric"] == metric)


# ---------------------------------------------------------------------------
# Shape
# ---------------------------------------------------------------------------


async def test_growth_returns_the_documented_shape(
    test_client: AsyncClient, admin_auth_headers: dict[str, str]
) -> None:
    response = await test_client.get(
        "/api/v1/admin/growth", headers=admin_auth_headers
    )

    assert response.status_code == 200
    assert set(response.json()) == {
        "window_days",
        "daily",
        "deltas",
        "generated_at",
    }


async def test_growth_zero_fills_every_day_in_the_window(
    test_client: AsyncClient, admin_auth_headers: dict[str, str]
) -> None:
    """The gaps are the point.

    A client that only receives days with rows has to invent the rest, and it
    will draw a straight line through a week of no activity — hiding exactly
    the flat stretch an operator wants to notice.
    """
    response = await test_client.get(
        "/api/v1/admin/growth?days=30", headers=admin_auth_headers
    )

    daily = response.json()["daily"]
    assert len(daily) == 30
    days = [point["day"] for point in daily]
    assert days == sorted(days)
    assert len(set(days)) == 30


async def test_growth_days_are_contiguous(
    test_client: AsyncClient, admin_auth_headers: dict[str, str]
) -> None:
    response = await test_client.get(
        "/api/v1/admin/growth?days=14", headers=admin_auth_headers
    )

    days = [
        datetime.fromisoformat(point["day"]).date()
        for point in response.json()["daily"]
    ]
    gaps = {(b - a).days for a, b in zip(days, days[1:])}
    assert gaps == {1}


async def test_growth_is_all_zeros_on_a_fresh_instance(
    test_client: AsyncClient, admin_auth_headers: dict[str, str]
) -> None:
    response = await test_client.get(
        "/api/v1/admin/growth?days=7", headers=admin_auth_headers
    )

    body = response.json()
    assert all(point["repos"] == 0 for point in body["daily"])
    assert all(point["collections"] == 0 for point in body["daily"])
    assert _delta(body, "repos")["added_in_window"] == 0


# ---------------------------------------------------------------------------
# Counting
# ---------------------------------------------------------------------------


async def test_growth_buckets_rows_onto_the_day_they_were_created(
    test_client: AsyncClient,
    db_session: AsyncSession,
    admin_auth_headers: dict[str, str],
    test_user: User,
) -> None:
    collection = await _collection(db_session, test_user, created_at=_ago(days=3))
    await _repo(db_session, collection, created_at=_ago(days=3))
    await _repo(db_session, collection, created_at=_ago(days=3))
    await _repo(db_session, collection, created_at=_ago(days=1))
    await db_session.commit()

    response = await test_client.get(
        "/api/v1/admin/growth?days=30", headers=admin_auth_headers
    )

    daily = {point["day"]: point for point in response.json()["daily"]}
    three_days_ago = _ago(days=3).date().isoformat()
    one_day_ago = _ago(days=1).date().isoformat()
    assert daily[three_days_ago]["repos"] == 2
    assert daily[one_day_ago]["repos"] == 1


async def test_growth_excludes_rows_older_than_the_window(
    test_client: AsyncClient,
    db_session: AsyncSession,
    admin_auth_headers: dict[str, str],
    test_user: User,
) -> None:
    collection = await _collection(db_session, test_user, created_at=_ago(days=200))
    await _repo(db_session, collection, created_at=_ago(days=200))
    await db_session.commit()

    response = await test_client.get(
        "/api/v1/admin/growth?days=7", headers=admin_auth_headers
    )

    body = response.json()
    assert sum(point["repos"] for point in body["daily"]) == 0
    # But the running total still knows about it.
    assert _delta(body, "repos")["current_total"] == 1


async def test_growth_counts_summaries_from_generated_at(
    test_client: AsyncClient,
    db_session: AsyncSession,
    admin_auth_headers: dict[str, str],
    test_user: User,
) -> None:
    collection = await _collection(db_session, test_user)
    repo = await _repo(db_session, collection)
    summary = Summary(
        id=uuid.uuid4(),
        repo_id=repo.id,
        summary_type="repo_overview",
        content="...",
        model_used="claude-test",
    )
    summary.generated_at = _ago(days=2)
    db_session.add(summary)
    await db_session.commit()

    response = await test_client.get(
        "/api/v1/admin/growth?days=30", headers=admin_auth_headers
    )

    body = response.json()
    assert sum(point["summaries"] for point in body["daily"]) == 1


# ---------------------------------------------------------------------------
# Deltas
# ---------------------------------------------------------------------------


async def test_deltas_cover_every_tracked_metric(
    test_client: AsyncClient, admin_auth_headers: dict[str, str]
) -> None:
    response = await test_client.get(
        "/api/v1/admin/growth", headers=admin_auth_headers
    )

    metrics = {item["metric"] for item in response.json()["deltas"]}
    assert metrics == {
        "repos",
        "users",
        "collections",
        "contributors",
        "summaries",
        "commit_classifications",
        "notes",
        "notifications",
    }


async def test_delta_compares_the_window_against_the_one_before_it(
    test_client: AsyncClient,
    db_session: AsyncSession,
    admin_auth_headers: dict[str, str],
    test_user: User,
) -> None:
    """Both halves are measured, so the comparison is honest.

    Two repos in the last 7 days, one in the 7 days before that. Nothing is
    fitted or annualised — these are row counts in two adjacent intervals.
    """
    collection = await _collection(db_session, test_user, created_at=_ago(days=20))
    await _repo(db_session, collection, created_at=_ago(days=2))
    await _repo(db_session, collection, created_at=_ago(days=3))
    await _repo(db_session, collection, created_at=_ago(days=10))
    await db_session.commit()

    response = await test_client.get(
        "/api/v1/admin/growth?days=7", headers=admin_auth_headers
    )

    delta = _delta(response.json(), "repos")
    assert delta["added_in_window"] == 2
    assert delta["added_in_previous_window"] == 1
    assert delta["current_total"] == 3


async def test_previous_window_does_not_overlap_the_current_one(
    test_client: AsyncClient,
    db_session: AsyncSession,
    admin_auth_headers: dict[str, str],
    test_user: User,
) -> None:
    """A row cannot be counted in both halves of the comparison."""
    collection = await _collection(db_session, test_user, created_at=_ago(days=1))
    await _repo(db_session, collection, created_at=_ago(days=1))
    await db_session.commit()

    response = await test_client.get(
        "/api/v1/admin/growth?days=7", headers=admin_auth_headers
    )

    delta = _delta(response.json(), "repos")
    assert delta["added_in_window"] == 1
    assert delta["added_in_previous_window"] == 0


async def test_delta_totals_are_instance_wide_not_window_wide(
    test_client: AsyncClient,
    db_session: AsyncSession,
    admin_auth_headers: dict[str, str],
    test_user: User,
) -> None:
    collection = await _collection(db_session, test_user, created_at=_ago(days=400))
    await _repo(db_session, collection, created_at=_ago(days=400))
    await _repo(db_session, collection, created_at=_ago(days=1))
    await db_session.commit()

    response = await test_client.get(
        "/api/v1/admin/growth?days=7", headers=admin_auth_headers
    )

    assert _delta(response.json(), "repos")["current_total"] == 2


# ---------------------------------------------------------------------------
# Window validation
# ---------------------------------------------------------------------------


async def test_growth_echoes_the_window_it_used(
    test_client: AsyncClient, admin_auth_headers: dict[str, str]
) -> None:
    response = await test_client.get(
        "/api/v1/admin/growth?days=90", headers=admin_auth_headers
    )

    assert response.json()["window_days"] == 90


@pytest.mark.parametrize("days", [0, -5, 400])
async def test_growth_rejects_a_window_outside_the_allowed_range(
    test_client: AsyncClient, admin_auth_headers: dict[str, str], days: int
) -> None:
    response = await test_client.get(
        f"/api/v1/admin/growth?days={days}", headers=admin_auth_headers
    )

    assert response.status_code == 422
