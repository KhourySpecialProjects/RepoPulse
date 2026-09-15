"""GET /api/v1/admin/pipeline — is ingestion working, and is the data complete?

These tests pin the admin/instructor boundary as much as the numbers. The
endpoint reports health data only as *coverage* (unknown status, NULL
health_score); it must never grow a green/yellow/red performance breakdown,
which is an instructor concern that CollectionDetailPage already owns.

The filesystem boundary arrives through get_admin_stats_service, so drift-based
coverage gaps use a FakeGitService rather than walking a real /repos mount.

The endpoint takes no window. Everything it reports is point-in-time, so
`test_pipeline_takes_no_window` pins that a `days` parameter does not quietly
come back and imply a filter the response would not honour.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.routes.admin import get_admin_stats_service
from app.main import app
from app.models.collection import Collection
from app.models.repo import Repo
from app.models.user import User
from app.services.admin_stats_service import AdminStatsService
from tests.factories.git import FakeGitService


def _ago(**kwargs: float) -> datetime:
    return datetime.now(timezone.utc) - timedelta(**kwargs)


async def _collection(db: AsyncSession, owner: User) -> Collection:
    slug = uuid.uuid4().hex[:8]
    collection = Collection(
        id=uuid.uuid4(),
        name=f"Collection {slug}",
        local_folder_name=f"coll-{slug}",
        owner_id=owner.id,
    )
    db.add(collection)
    await db.flush()
    return collection


async def _repo(
    db: AsyncSession,
    collection: Collection,
    *,
    name: str | None = None,
    sync_status: str = "idle",
    sync_error: str | None = None,
    last_synced_at: datetime | None = None,
    local_path: str | None = None,
    size_bytes: int | None = None,
    health_status: str = "unknown",
    health_score: dict | None = None,
) -> Repo:
    name = name or f"repo-{uuid.uuid4().hex[:8]}"
    repo = Repo(
        id=uuid.uuid4(),
        collection_id=collection.id,
        github_url=f"https://github.com/acme/{name}",
        name=name,
        sync_status=sync_status,
        sync_error=sync_error,
        last_synced_at=last_synced_at,
        local_path=local_path,
        size_bytes=size_bytes,
        health_status=health_status,
        health_score=health_score,
    )
    db.add(repo)
    await db.flush()
    return repo


@pytest.fixture
def fake_git() -> FakeGitService:
    return FakeGitService()


@pytest_asyncio.fixture
async def override_service(fake_git: FakeGitService):
    app.dependency_overrides[get_admin_stats_service] = lambda: AdminStatsService(
        git_service=fake_git
    )
    yield fake_git
    app.dependency_overrides.pop(get_admin_stats_service, None)


def _gap(body: dict, key: str) -> dict:
    return next(item for item in body["coverage"] if item["key"] == key)


def _bucket(body: dict, key: str) -> dict:
    return next(item for item in body["sync_age"] if item["key"] == key)


# ---------------------------------------------------------------------------
# Shape
# ---------------------------------------------------------------------------


async def test_pipeline_returns_the_documented_shape(
    test_client: AsyncClient,
    admin_auth_headers: dict[str, str],
    override_service: FakeGitService,
) -> None:
    response = await test_client.get(
        "/api/v1/admin/pipeline", headers=admin_auth_headers
    )

    assert response.status_code == 200
    body = response.json()
    assert set(body) == {
        "sync_state",
        "sync_errors",
        "sync_age",
        "coverage",
        "generated_at",
    }


async def test_pipeline_is_empty_but_well_formed_on_a_fresh_instance(
    test_client: AsyncClient,
    admin_auth_headers: dict[str, str],
    override_service: FakeGitService,
) -> None:
    """Zeros, never nulls, and never a missing key."""
    response = await test_client.get(
        "/api/v1/admin/pipeline", headers=admin_auth_headers
    )

    body = response.json()
    assert body["sync_state"] == {"idle": 0, "syncing": 0, "failed": 0}
    assert body["sync_errors"] == []
    assert all(bucket["repos"] == 0 for bucket in body["sync_age"])
    assert all(gap["affected"] == 0 for gap in body["coverage"])


async def test_pipeline_never_reports_a_health_performance_breakdown(
    test_client: AsyncClient,
    db_session: AsyncSession,
    admin_auth_headers: dict[str, str],
    override_service: FakeGitService,
    test_user: User,
) -> None:
    """The admin/instructor boundary, pinned.

    Green and yellow counts are an instructor's question. If someone later
    adds them here, this fails and they have to justify it.
    """
    collection = await _collection(db_session, test_user)
    await _repo(db_session, collection, health_status="green")
    await _repo(db_session, collection, health_status="red")
    await db_session.commit()

    response = await test_client.get(
        "/api/v1/admin/pipeline", headers=admin_auth_headers
    )

    body = response.json()
    coverage_keys = {gap["key"] for gap in body["coverage"]}
    assert "green" not in coverage_keys
    assert "yellow" not in coverage_keys
    assert "red" not in coverage_keys
    # Only the operations-relevant slice of health data is present.
    assert "unknown_health" in coverage_keys
    assert "no_health_score" in coverage_keys


# ---------------------------------------------------------------------------
# Sync state and error grouping
# ---------------------------------------------------------------------------


async def test_sync_state_counts_all_three_states(
    test_client: AsyncClient,
    db_session: AsyncSession,
    admin_auth_headers: dict[str, str],
    override_service: FakeGitService,
    test_user: User,
) -> None:
    collection = await _collection(db_session, test_user)
    await _repo(db_session, collection, sync_status="idle")
    await _repo(db_session, collection, sync_status="idle")
    await _repo(db_session, collection, sync_status="syncing")
    await _repo(db_session, collection, sync_status="failed", sync_error="boom")
    await db_session.commit()

    response = await test_client.get(
        "/api/v1/admin/pipeline", headers=admin_auth_headers
    )

    assert response.json()["sync_state"] == {"idle": 2, "syncing": 1, "failed": 1}


async def test_identical_sync_errors_collapse_into_one_group(
    test_client: AsyncClient,
    db_session: AsyncSession,
    admin_auth_headers: dict[str, str],
    override_service: FakeGitService,
    test_user: User,
) -> None:
    """The whole point of grouping: one fault reads as one row.

    Three repos failing on the same credential is one problem to fix, not
    three, and an admin should not have to compare strings by eye to see it.
    """
    collection = await _collection(db_session, test_user)
    for _ in range(3):
        await _repo(
            db_session,
            collection,
            sync_status="failed",
            sync_error="Authentication failed",
            last_synced_at=_ago(hours=2),
        )
    await _repo(
        db_session,
        collection,
        sync_status="failed",
        sync_error="Host unreachable",
        last_synced_at=_ago(hours=1),
    )
    await db_session.commit()

    response = await test_client.get(
        "/api/v1/admin/pipeline", headers=admin_auth_headers
    )

    groups = response.json()["sync_errors"]
    assert len(groups) == 2
    # Largest group first: the systemic fault is the one to look at.
    assert groups[0]["error"] == "Authentication failed"
    assert groups[0]["repos"] == 3
    assert groups[0]["example_repo_name"]
    assert groups[1]["error"] == "Host unreachable"
    assert groups[1]["repos"] == 1


async def test_sync_errors_ignore_repos_that_are_not_failing(
    test_client: AsyncClient,
    db_session: AsyncSession,
    admin_auth_headers: dict[str, str],
    override_service: FakeGitService,
    test_user: User,
) -> None:
    """A stale sync_error on a now-idle repo is history, not a live fault."""
    collection = await _collection(db_session, test_user)
    await _repo(
        db_session,
        collection,
        sync_status="idle",
        sync_error="Authentication failed",
    )
    await db_session.commit()

    response = await test_client.get(
        "/api/v1/admin/pipeline", headers=admin_auth_headers
    )

    assert response.json()["sync_errors"] == []


# ---------------------------------------------------------------------------
# Sync age histogram
# ---------------------------------------------------------------------------


async def test_sync_age_buckets_are_always_present_and_ordered(
    test_client: AsyncClient,
    admin_auth_headers: dict[str, str],
    override_service: FakeGitService,
) -> None:
    """A histogram that drops empty buckets misstates the distribution."""
    response = await test_client.get(
        "/api/v1/admin/pipeline", headers=admin_auth_headers
    )

    keys = [bucket["key"] for bucket in response.json()["sync_age"]]
    assert keys == ["lt1d", "1to3d", "3to7d", "7to30d", "gt30d", "never"]


async def test_sync_age_places_each_repo_in_exactly_one_bucket(
    test_client: AsyncClient,
    db_session: AsyncSession,
    admin_auth_headers: dict[str, str],
    override_service: FakeGitService,
    test_user: User,
) -> None:
    collection = await _collection(db_session, test_user)
    await _repo(db_session, collection, last_synced_at=_ago(hours=3))
    await _repo(db_session, collection, last_synced_at=_ago(days=2))
    await _repo(db_session, collection, last_synced_at=_ago(days=5))
    await _repo(db_session, collection, last_synced_at=_ago(days=20))
    await _repo(db_session, collection, last_synced_at=_ago(days=100))
    await _repo(db_session, collection, last_synced_at=None)
    await db_session.commit()

    response = await test_client.get(
        "/api/v1/admin/pipeline", headers=admin_auth_headers
    )

    body = response.json()
    assert _bucket(body, "lt1d")["repos"] == 1
    assert _bucket(body, "1to3d")["repos"] == 1
    assert _bucket(body, "3to7d")["repos"] == 1
    assert _bucket(body, "7to30d")["repos"] == 1
    assert _bucket(body, "gt30d")["repos"] == 1
    assert _bucket(body, "never")["repos"] == 1
    # Buckets partition the fleet: every repo counted once, none twice.
    assert sum(bucket["repos"] for bucket in body["sync_age"]) == 6


async def test_never_synced_is_its_own_bucket_not_an_infinite_age(
    test_client: AsyncClient,
    db_session: AsyncSession,
    admin_auth_headers: dict[str, str],
    override_service: FakeGitService,
    test_user: User,
) -> None:
    """A repo that never synced is not "synced a very long time ago"."""
    collection = await _collection(db_session, test_user)
    await _repo(db_session, collection, last_synced_at=None)
    await db_session.commit()

    response = await test_client.get(
        "/api/v1/admin/pipeline", headers=admin_auth_headers
    )

    body = response.json()
    assert _bucket(body, "never")["repos"] == 1
    assert _bucket(body, "gt30d")["repos"] == 0


# ---------------------------------------------------------------------------
# Coverage gaps
# ---------------------------------------------------------------------------


async def test_coverage_gaps_are_always_all_present(
    test_client: AsyncClient,
    admin_auth_headers: dict[str, str],
    override_service: FakeGitService,
) -> None:
    response = await test_client.get(
        "/api/v1/admin/pipeline", headers=admin_auth_headers
    )

    keys = [gap["key"] for gap in response.json()["coverage"]]
    assert keys == [
        "no_health_score",
        "unknown_health",
        "unmeasured_clone",
        "missing_clone",
        "orphan_directory",
        "unattributed_summary",
    ]


async def test_coverage_counts_null_health_scores_and_unknown_status(
    test_client: AsyncClient,
    db_session: AsyncSession,
    admin_auth_headers: dict[str, str],
    override_service: FakeGitService,
    test_user: User,
) -> None:
    """Both are pipeline signals, and they are not the same signal.

    A repo can carry a stored breakdown and still read `unknown` once its last
    sync ages past the staleness window, so the two counts diverge.
    """
    collection = await _collection(db_session, test_user)
    await _repo(db_session, collection, health_status="unknown", health_score=None)
    await _repo(
        db_session,
        collection,
        health_status="green",
        health_score={"composite": 1.8, "status": "green"},
    )
    await db_session.commit()

    response = await test_client.get(
        "/api/v1/admin/pipeline", headers=admin_auth_headers
    )

    body = response.json()
    assert _gap(body, "no_health_score")["affected"] == 1
    assert _gap(body, "no_health_score")["total"] == 2
    assert _gap(body, "unknown_health")["affected"] == 1
    assert _gap(body, "unknown_health")["total"] == 2


async def test_coverage_counts_unmeasured_clones_separately_from_empty_ones(
    test_client: AsyncClient,
    db_session: AsyncSession,
    admin_auth_headers: dict[str, str],
    override_service: FakeGitService,
    test_user: User,
) -> None:
    """NULL size_bytes is "never measured"; 0 is "measured and empty"."""
    collection = await _collection(db_session, test_user)
    await _repo(db_session, collection, size_bytes=None)
    await _repo(db_session, collection, size_bytes=0)
    await _repo(db_session, collection, size_bytes=4096)
    await db_session.commit()

    response = await test_client.get(
        "/api/v1/admin/pipeline", headers=admin_auth_headers
    )

    gap = _gap(response.json(), "unmeasured_clone")
    assert gap["affected"] == 1
    assert gap["total"] == 3


async def test_coverage_reports_missing_clones_and_orphan_directories(
    test_client: AsyncClient,
    db_session: AsyncSession,
    admin_auth_headers: dict[str, str],
    override_service: FakeGitService,
    test_user: User,
) -> None:
    """Drift in both directions, from one filesystem snapshot."""
    collection = await _collection(db_session, test_user)
    await _repo(db_session, collection, local_path="/repos/coll/present")
    await _repo(db_session, collection, local_path="/repos/coll/vanished")
    await db_session.commit()
    override_service.directories = ["/repos/coll/present", "/repos/coll/abandoned"]

    response = await test_client.get(
        "/api/v1/admin/pipeline", headers=admin_auth_headers
    )

    body = response.json()
    assert _gap(body, "missing_clone")["affected"] == 1
    orphan = _gap(body, "orphan_directory")
    assert orphan["affected"] == 1
    # Orphans are counted against directories on disk, not against repo rows:
    # a directory with no row is not one of the rows.
    assert orphan["total"] == 2


async def test_coverage_never_sizes_orphan_directories(
    test_client: AsyncClient,
    admin_auth_headers: dict[str, str],
    override_service: FakeGitService,
) -> None:
    """One abandoned multi-gigabyte clone would stall the landing page."""
    override_service.directories = ["/repos/coll/abandoned"]

    await test_client.get("/api/v1/admin/pipeline", headers=admin_auth_headers)

    assert override_service.size_calls == []


# ---------------------------------------------------------------------------
# No window
# ---------------------------------------------------------------------------


async def test_pipeline_takes_no_window(
    test_client: AsyncClient,
    admin_auth_headers: dict[str, str],
    override_service: FakeGitService,
) -> None:
    """A snapshot does not advertise a filter it cannot honour.

    `days` briefly existed here and scoped only an email-delivery figure that
    has since been removed. FastAPI ignores unknown query parameters, so the
    guarantee worth pinning is that the response carries no window field and
    reads identically with or without one.
    """
    plain = await test_client.get("/api/v1/admin/pipeline", headers=admin_auth_headers)
    with_days = await test_client.get(
        "/api/v1/admin/pipeline?days=7", headers=admin_auth_headers
    )

    assert plain.status_code == 200
    assert with_days.status_code == 200
    assert "window_days" not in plain.json()

    ignoring_timestamp = {k: v for k, v in plain.json().items() if k != "generated_at"}
    assert ignoring_timestamp == {
        k: v for k, v in with_days.json().items() if k != "generated_at"
    }
