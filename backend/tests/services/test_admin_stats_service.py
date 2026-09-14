"""Instance-wide aggregates behind the admin dashboard.

Fixture discipline, and it is the trap in this file: `db_session` is a
rolled-back transaction over an otherwise empty database, so tables genuinely
start empty — but every fixture a test requests inserts rows these counts will
then see. A test asserting an empty instance must request neither `test_user`
nor `admin_user`.

These aggregates are deliberately unscoped: no method takes a `user_id`, which
is what structurally guarantees an admin sees the whole instance rather than
their own permission scope. `test_no_aggregate_method_accepts_a_user_id` pins
that, and is a stronger guarantee than any data-level assertion, because
`permission_service` already treats an admin as owner-of-everything.
"""

from __future__ import annotations

import inspect
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.collection import Collection
from app.models.repo import Repo
from app.models.user import User
from app.services.admin_stats_service import AdminStatsService

service = AdminStatsService()


async def _user(
    db: AsyncSession, role: str = "instructor", email: str | None = None
) -> User:
    user = User(
        id=uuid.uuid4(),
        email=email or f"{role}-{uuid.uuid4().hex[:8]}@example.com",
        display_name=f"{role} user",
        role=role,
        password_hash=None,
    )
    db.add(user)
    await db.flush()
    return user


async def _collection(
    db: AsyncSession, owner: User, *, archived: bool = False
) -> Collection:
    slug = uuid.uuid4().hex[:8]
    collection = Collection(
        id=uuid.uuid4(),
        name=f"Collection {slug}",
        local_folder_name=f"collection-{slug}",
        owner_id=owner.id,
        is_archived=archived,
    )
    db.add(collection)
    await db.flush()
    return collection


async def _repo(
    db: AsyncSession,
    collection: Collection,
    *,
    health: str = "unknown",
    last_synced_at: datetime | None = None,
) -> Repo:
    slug = uuid.uuid4().hex[:8]
    repo = Repo(
        id=uuid.uuid4(),
        collection_id=collection.id,
        github_url=f"https://github.com/acme/{slug}",
        name=f"repo-{slug}",
        health_status=health,
        last_synced_at=last_synced_at,
    )
    db.add(repo)
    await db.flush()
    return repo


# ---------------------------------------------------------------------------
# entity_counts
# ---------------------------------------------------------------------------


async def test_entity_counts_are_zero_on_an_empty_instance(
    db_session: AsyncSession,
) -> None:
    """Requests no user fixtures on purpose — see the module docstring."""
    counts = await service.entity_counts(db_session)
    assert counts.users == 0
    assert counts.collections == 0
    assert counts.repos == 0
    assert counts.summaries == 0


async def test_entity_counts_break_users_down_by_role(
    db_session: AsyncSession,
) -> None:
    await _user(db_session, "admin")
    await _user(db_session, "instructor")
    await _user(db_session, "instructor")
    await _user(db_session, "ta")

    counts = await service.entity_counts(db_session)

    assert counts.users == 4
    assert counts.admins == 1
    assert counts.instructors == 2
    assert counts.tas == 1


async def test_entity_counts_report_the_admin_count(
    db_session: AsyncSession,
) -> None:
    """Exactly one admin is a lockout risk; zero is unrecoverable.

    This must be an exact count, never an estimate.
    """
    await _user(db_session, "admin")
    counts = await service.entity_counts(db_session)
    assert counts.admins == 1


async def test_entity_counts_count_collections_repos_and_archived(
    db_session: AsyncSession,
) -> None:
    owner = await _user(db_session)
    live = await _collection(db_session, owner)
    await _collection(db_session, owner, archived=True)
    await _repo(db_session, live)
    await _repo(db_session, live)

    counts = await service.entity_counts(db_session)

    assert counts.collections == 2
    assert counts.archived_collections == 1
    assert counts.repos == 2


# ---------------------------------------------------------------------------
# health_distribution
# ---------------------------------------------------------------------------


async def test_health_distribution_zero_fills_absent_statuses(
    db_session: AsyncSession,
) -> None:
    """A status with no repos must serialise as 0, never be missing.

    A dashboard that omits `red` when nothing is red renders a broken chart.
    """
    owner = await _user(db_session)
    collection = await _collection(db_session, owner)
    await _repo(db_session, collection, health="green")
    await _repo(db_session, collection, health="green")
    await _repo(db_session, collection, health="red")

    health = await service.health_distribution(db_session)

    assert health.green == 2
    assert health.red == 1
    assert health.yellow == 0
    assert health.unknown == 0


async def test_health_distribution_is_all_zero_on_an_empty_instance(
    db_session: AsyncSession,
) -> None:
    health = await service.health_distribution(db_session)
    assert (health.green, health.yellow, health.red, health.unknown) == (0, 0, 0, 0)


# ---------------------------------------------------------------------------
# sync_freshness
# ---------------------------------------------------------------------------


async def test_sync_freshness_splits_never_stale_and_fresh(
    db_session: AsyncSession,
) -> None:
    owner = await _user(db_session)
    collection = await _collection(db_session, owner)
    now = datetime.now(timezone.utc)
    await _repo(db_session, collection, last_synced_at=None)
    await _repo(db_session, collection, last_synced_at=now - timedelta(days=30))
    recent = now - timedelta(hours=1)
    await _repo(db_session, collection, last_synced_at=recent)

    sync = await service.sync_freshness(db_session, stale_after_days=7)

    assert sync.total == 3
    assert sync.never_synced == 1
    assert sync.stale == 1
    assert sync.fresh == 1
    assert sync.most_recent_sync is not None
    assert abs((sync.most_recent_sync - recent).total_seconds()) < 5


async def test_sync_freshness_honours_the_window(
    db_session: AsyncSession,
) -> None:
    owner = await _user(db_session)
    collection = await _collection(db_session, owner)
    await _repo(
        db_session,
        collection,
        last_synced_at=datetime.now(timezone.utc) - timedelta(days=10),
    )

    assert (await service.sync_freshness(db_session, stale_after_days=7)).stale == 1
    assert (await service.sync_freshness(db_session, stale_after_days=30)).stale == 0


async def test_sync_freshness_is_zero_on_an_empty_instance(
    db_session: AsyncSession,
) -> None:
    sync = await service.sync_freshness(db_session)
    assert sync.total == 0
    assert sync.never_synced == 0
    assert sync.most_recent_sync is None


# ---------------------------------------------------------------------------
# overview
# ---------------------------------------------------------------------------


async def test_overview_composes_counts_health_and_sync(
    db_session: AsyncSession,
) -> None:
    owner = await _user(db_session)
    collection = await _collection(db_session, owner)
    await _repo(db_session, collection, health="green")

    overview = await service.overview(db_session, stale_after_days=7)

    assert overview.counts.repos == 1
    assert overview.health.green == 1
    assert overview.sync.total == 1
    assert overview.sync.stale_after_days == 7
    assert overview.generated_at is not None


# ---------------------------------------------------------------------------
# Structural guarantee
# ---------------------------------------------------------------------------


def test_no_aggregate_method_accepts_a_user_id() -> None:
    """Admin aggregates are instance-wide by construction.

    There must be no parameter through which a permission scope could be
    threaded in. This is a stronger guarantee than asserting on data, because
    permission_service already returns everything for an admin — a scoped
    implementation could pass a data-level test for the wrong reason.
    """
    for name, method in inspect.getmembers(AdminStatsService, inspect.isfunction):
        if name.startswith("_"):
            continue
        params = set(inspect.signature(method).parameters)
        assert not params & {"user_id", "current_user_id", "user", "subject"}, (
            f"AdminStatsService.{name} accepts a caller identity; "
            "admin aggregates must be unscoped"
        )
