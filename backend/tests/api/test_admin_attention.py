"""GET /api/v1/admin/attention — repos with an operational fault, worst first.

The reason codes are the contract worth defending. They are operational only:
sync failures, missing clones, absent measurements. A repo whose students have
stopped committing is *not* here, because that is an instructor's problem and
mixing it in would bury the faults only an admin can fix.
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


async def _collection(db: AsyncSession, owner: User, *, name: str | None = None):
    slug = uuid.uuid4().hex[:8]
    collection = Collection(
        id=uuid.uuid4(),
        name=name or f"Collection {slug}",
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
    name: str,
    sync_status: str = "idle",
    sync_error: str | None = None,
    last_synced_at: datetime | None = None,
    local_path: str | None = None,
    size_bytes: int | None = None,
    health_score: dict | None = None,
) -> Repo:
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
        health_score=health_score,
    )
    db.add(repo)
    await db.flush()
    return repo


async def _healthy_repo(db: AsyncSession, collection: Collection, *, name: str):
    """A repo with nothing wrong with it — must never appear in the list."""
    return await _repo(
        db,
        collection,
        name=name,
        sync_status="idle",
        last_synced_at=_ago(hours=1),
        local_path=f"/repos/coll/{name}",
        size_bytes=4096,
        health_score={"composite": 1.9, "status": "green"},
    )


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


def _codes(item: dict) -> set[str]:
    return {reason["code"] for reason in item["reasons"]}


# ---------------------------------------------------------------------------
# Envelope
# ---------------------------------------------------------------------------


async def test_attention_uses_the_house_pagination_envelope(
    test_client: AsyncClient,
    admin_auth_headers: dict[str, str],
    override_service: FakeGitService,
) -> None:
    response = await test_client.get(
        "/api/v1/admin/attention", headers=admin_auth_headers
    )

    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"items", "total", "limit", "offset", "generated_at"}
    assert body["items"] == []
    assert body["total"] == 0


async def test_attention_respects_limit_and_offset(
    test_client: AsyncClient,
    db_session: AsyncSession,
    admin_auth_headers: dict[str, str],
    override_service: FakeGitService,
    test_user: User,
) -> None:
    collection = await _collection(db_session, test_user)
    for index in range(5):
        await _repo(
            db_session,
            collection,
            name=f"broken-{index}",
            sync_status="failed",
            sync_error="boom",
        )
    await db_session.commit()

    response = await test_client.get(
        "/api/v1/admin/attention?limit=2&offset=1", headers=admin_auth_headers
    )

    body = response.json()
    assert len(body["items"]) == 2
    assert body["total"] == 5
    assert body["limit"] == 2
    assert body["offset"] == 1


# ---------------------------------------------------------------------------
# Which repos qualify
# ---------------------------------------------------------------------------


async def test_a_repo_with_nothing_wrong_is_absent(
    test_client: AsyncClient,
    db_session: AsyncSession,
    admin_auth_headers: dict[str, str],
    override_service: FakeGitService,
    test_user: User,
) -> None:
    collection = await _collection(db_session, test_user)
    await _healthy_repo(db_session, collection, name="fine")
    await db_session.commit()
    override_service.directories = ["/repos/coll/fine"]

    response = await test_client.get(
        "/api/v1/admin/attention", headers=admin_auth_headers
    )

    assert response.json()["items"] == []


async def test_a_failing_sync_is_flagged_with_its_error(
    test_client: AsyncClient,
    db_session: AsyncSession,
    admin_auth_headers: dict[str, str],
    override_service: FakeGitService,
    test_user: User,
) -> None:
    collection = await _collection(db_session, test_user, name="Fall 2026")
    await _repo(
        db_session,
        collection,
        name="broken",
        sync_status="failed",
        sync_error="Authentication failed",
        local_path="/repos/coll/broken",
        size_bytes=1024,
        last_synced_at=_ago(hours=2),
        health_score={"composite": 1.0, "status": "yellow"},
    )
    await db_session.commit()
    override_service.directories = ["/repos/coll/broken"]

    response = await test_client.get(
        "/api/v1/admin/attention", headers=admin_auth_headers
    )

    item = response.json()["items"][0]
    assert item["name"] == "broken"
    assert item["collection_name"] == "Fall 2026"
    assert item["sync_error"] == "Authentication failed"
    assert "sync_failed" in _codes(item)


async def test_never_synced_and_stale_sync_are_distinct_reasons(
    test_client: AsyncClient,
    db_session: AsyncSession,
    admin_auth_headers: dict[str, str],
    override_service: FakeGitService,
    test_user: User,
) -> None:
    collection = await _collection(db_session, test_user)
    await _repo(db_session, collection, name="never", last_synced_at=None)
    await _repo(
        db_session,
        collection,
        name="stale",
        last_synced_at=_ago(days=30),
        local_path="/repos/coll/stale",
        size_bytes=1024,
        health_score={"composite": 1.0, "status": "yellow"},
    )
    await db_session.commit()
    override_service.directories = ["/repos/coll/stale"]

    response = await test_client.get(
        "/api/v1/admin/attention", headers=admin_auth_headers
    )

    by_name = {item["name"]: item for item in response.json()["items"]}
    assert "never_synced" in _codes(by_name["never"])
    assert "stale_sync" in _codes(by_name["stale"])
    assert "stale_sync" not in _codes(by_name["never"])


async def test_a_database_row_with_no_clone_on_disk_is_flagged(
    test_client: AsyncClient,
    db_session: AsyncSession,
    admin_auth_headers: dict[str, str],
    override_service: FakeGitService,
    test_user: User,
) -> None:
    collection = await _collection(db_session, test_user)
    await _repo(
        db_session,
        collection,
        name="vanished",
        local_path="/repos/coll/vanished",
        last_synced_at=_ago(hours=1),
        size_bytes=1024,
        health_score={"composite": 1.9, "status": "green"},
    )
    await db_session.commit()
    override_service.directories = []

    response = await test_client.get(
        "/api/v1/admin/attention", headers=admin_auth_headers
    )

    item = response.json()["items"][0]
    assert "clone_missing" in _codes(item)


async def test_an_unmeasured_clone_is_flagged_but_a_measured_empty_one_is_not(
    test_client: AsyncClient,
    db_session: AsyncSession,
    admin_auth_headers: dict[str, str],
    override_service: FakeGitService,
    test_user: User,
) -> None:
    """NULL is "never measured"; 0 is a real measurement of an empty clone."""
    collection = await _collection(db_session, test_user)
    await _repo(
        db_session,
        collection,
        name="unmeasured",
        local_path="/repos/coll/unmeasured",
        last_synced_at=_ago(hours=1),
        size_bytes=None,
        health_score={"composite": 1.9, "status": "green"},
    )
    await _repo(
        db_session,
        collection,
        name="empty",
        local_path="/repos/coll/empty",
        last_synced_at=_ago(hours=1),
        size_bytes=0,
        health_score={"composite": 1.9, "status": "green"},
    )
    await db_session.commit()
    override_service.directories = [
        "/repos/coll/unmeasured",
        "/repos/coll/empty",
    ]

    response = await test_client.get(
        "/api/v1/admin/attention", headers=admin_auth_headers
    )

    names = {item["name"] for item in response.json()["items"]}
    assert "unmeasured" in names
    assert "empty" not in names


async def test_a_missing_health_score_is_flagged_as_a_pipeline_gap(
    test_client: AsyncClient,
    db_session: AsyncSession,
    admin_auth_headers: dict[str, str],
    override_service: FakeGitService,
    test_user: User,
) -> None:
    collection = await _collection(db_session, test_user)
    await _repo(
        db_session,
        collection,
        name="unscored",
        local_path="/repos/coll/unscored",
        last_synced_at=_ago(hours=1),
        size_bytes=1024,
        health_score=None,
    )
    await db_session.commit()
    override_service.directories = ["/repos/coll/unscored"]

    response = await test_client.get(
        "/api/v1/admin/attention", headers=admin_auth_headers
    )

    assert "no_health_data" in _codes(response.json()["items"][0])


async def test_a_red_health_status_is_never_a_reason(
    test_client: AsyncClient,
    db_session: AsyncSession,
    admin_auth_headers: dict[str, str],
    override_service: FakeGitService,
    test_user: User,
) -> None:
    """The admin/instructor boundary, pinned where it is easiest to violate.

    A red repo that is otherwise operationally fine is a struggling student
    project, not an admin action item. It must not appear here at all.
    """
    collection = await _collection(db_session, test_user)
    await _repo(
        db_session,
        collection,
        name="struggling",
        local_path="/repos/coll/struggling",
        last_synced_at=_ago(hours=1),
        size_bytes=1024,
        health_score={"composite": 0.2, "status": "red"},
    )
    await db_session.commit()
    override_service.directories = ["/repos/coll/struggling"]

    response = await test_client.get(
        "/api/v1/admin/attention", headers=admin_auth_headers
    )

    assert response.json()["items"] == []


# ---------------------------------------------------------------------------
# Ordering
# ---------------------------------------------------------------------------


async def test_worst_repos_come_first(
    test_client: AsyncClient,
    db_session: AsyncSession,
    admin_auth_headers: dict[str, str],
    override_service: FakeGitService,
    test_user: User,
) -> None:
    collection = await _collection(db_session, test_user)
    # Three faults: failing, never synced, no clone, unmeasured, unscored.
    await _repo(
        db_session,
        collection,
        name="catastrophe",
        sync_status="failed",
        sync_error="boom",
        last_synced_at=None,
        local_path=None,
        size_bytes=None,
        health_score=None,
    )
    # One fault: unmeasured only.
    await _repo(
        db_session,
        collection,
        name="minor",
        local_path="/repos/coll/minor",
        last_synced_at=_ago(hours=1),
        size_bytes=None,
        health_score={"composite": 1.9, "status": "green"},
    )
    await db_session.commit()
    override_service.directories = ["/repos/coll/minor"]

    response = await test_client.get(
        "/api/v1/admin/attention", headers=admin_auth_headers
    )

    items = response.json()["items"]
    assert [item["name"] for item in items] == ["catastrophe", "minor"]
    assert items[0]["severity"] > items[1]["severity"]


async def test_equal_severity_falls_back_to_name_so_pages_are_stable(
    test_client: AsyncClient,
    db_session: AsyncSession,
    admin_auth_headers: dict[str, str],
    override_service: FakeGitService,
    test_user: User,
) -> None:
    """Without a tiebreak, LIMIT/OFFSET can repeat or skip rows across pages."""
    collection = await _collection(db_session, test_user)
    for name in ("charlie", "alpha", "bravo"):
        await _repo(
            db_session,
            collection,
            name=name,
            sync_status="failed",
            sync_error="boom",
        )
    await db_session.commit()

    first = await test_client.get(
        "/api/v1/admin/attention?limit=2&offset=0", headers=admin_auth_headers
    )
    second = await test_client.get(
        "/api/v1/admin/attention?limit=2&offset=2", headers=admin_auth_headers
    )

    page_one = [item["name"] for item in first.json()["items"]]
    page_two = [item["name"] for item in second.json()["items"]]
    assert page_one == ["alpha", "bravo"]
    assert page_two == ["charlie"]
    assert not set(page_one) & set(page_two)


async def test_every_reason_carries_a_human_label(
    test_client: AsyncClient,
    db_session: AsyncSession,
    admin_auth_headers: dict[str, str],
    override_service: FakeGitService,
    test_user: User,
) -> None:
    collection = await _collection(db_session, test_user)
    await _repo(
        db_session,
        collection,
        name="broken",
        sync_status="failed",
        sync_error="boom",
    )
    await db_session.commit()

    response = await test_client.get(
        "/api/v1/admin/attention", headers=admin_auth_headers
    )

    for reason in response.json()["items"][0]["reasons"]:
        assert reason["label"]
        assert reason["label"] != reason["code"]


@pytest.mark.parametrize(("limit", "offset"), [(0, 0), (201, 0), (10, -1)])
async def test_attention_rejects_out_of_range_pagination(
    test_client: AsyncClient,
    admin_auth_headers: dict[str, str],
    override_service: FakeGitService,
    limit: int,
    offset: int,
) -> None:
    response = await test_client.get(
        f"/api/v1/admin/attention?limit={limit}&offset={offset}",
        headers=admin_auth_headers,
    )

    assert response.status_code == 422
