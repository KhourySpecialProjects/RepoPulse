"""Storage endpoints: /admin/storage, /admin/storage/repos, recalculate.

The filesystem boundary arrives through the get_admin_stats_service
dependency, so these override it with a FakeGitService rather than walking a
real /repos mount. That is deliberate: a background implementation would
escape the autouse no_background_indexing fixture and open a session against
DATABASE_URL instead of TEST_DATABASE_URL.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.routes.admin import get_admin_stats_service
from app.main import app
from app.models.app_settings import AppSettings
from app.models.collection import Collection
from app.models.repo import Repo
from app.models.user import User
from app.services.admin_stats_service import AdminStatsService
from tests.factories.git import FakeGitService


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
    name: str,
    local_path: str | None = None,
    size_bytes: int | None = None,
    git_size_bytes: int | None = None,
    size_computed_at: datetime | None = None,
) -> Repo:
    repo = Repo(
        id=uuid.uuid4(),
        collection_id=collection.id,
        github_url=f"https://github.com/acme/{name}",
        name=name,
        local_path=local_path,
        size_bytes=size_bytes,
        git_size_bytes=git_size_bytes,
        size_computed_at=size_computed_at,
    )
    db.add(repo)
    await db.flush()
    return repo


@pytest.fixture
def fake_git() -> FakeGitService:
    return FakeGitService()


@pytest_asyncio.fixture
async def override_service(fake_git: FakeGitService):
    """Swap the filesystem boundary for the duration of a test."""
    app.dependency_overrides[get_admin_stats_service] = lambda: AdminStatsService(
        git_service=fake_git
    )
    yield fake_git
    app.dependency_overrides.pop(get_admin_stats_service, None)


# ---------------------------------------------------------------------------
# GET /admin/storage
# ---------------------------------------------------------------------------


async def test_storage_reports_disk_database_and_tables(
    test_client: AsyncClient,
    admin_auth_headers: dict[str, str],
    override_service: FakeGitService,
) -> None:
    response = await test_client.get("/api/v1/admin/storage", headers=admin_auth_headers)

    assert response.status_code == 200
    body = response.json()
    assert set(body) == {
        "disk",
        "clones",
        "database_bytes",
        "tables",
        "drift",
        "repo_root_dir",
        "generated_at",
    }
    assert body["database_bytes"] > 0
    assert len(body["tables"]) > 0
    assert all(table["total_bytes"] > 0 for table in body["tables"])


async def test_storage_row_counts_are_exact_not_planner_estimates(
    test_client: AsyncClient,
    db_session: AsyncSession,
    admin_auth_headers: dict[str, str],
    test_user: User,
    override_service: FakeGitService,
) -> None:
    """n_live_tup reads 0 until autovacuum runs, which is exactly when an
    administrator first looks at a freshly seeded instance."""
    collection = await _collection(db_session, test_user)
    await _repo(db_session, collection, name="a")
    await _repo(db_session, collection, name="b")
    await _repo(db_session, collection, name="c")

    response = await test_client.get("/api/v1/admin/storage", headers=admin_auth_headers)

    tables = {t["table_name"]: t for t in response.json()["tables"]}
    assert tables["repos"]["row_count"] == 3


async def test_storage_reports_the_real_repo_root_not_the_per_user_setting(
    test_client: AsyncClient,
    db_session: AsyncSession,
    admin_auth_headers: dict[str, str],
    admin_user: User,
    override_service: FakeGitService,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """AppSettings.repo_root_directory is per-user, display-only, and is never
    consulted when building clone paths. The System/Storage views must show
    the config value that clones actually live under.

    The negative assertion is the one that matters.
    """
    db_session.add(
        AppSettings(
            id=uuid.uuid4(),
            user_id=admin_user.id,
            repo_root_directory="/somewhere/else",
        )
    )
    await db_session.flush()
    monkeypatch.setattr(
        "app.services.admin_stats_service.settings.REPO_ROOT_DIR", "/repos"
    )

    response = await test_client.get("/api/v1/admin/storage", headers=admin_auth_headers)

    assert response.json()["repo_root_dir"] == "/repos"
    assert "/somewhere/else" not in response.text


async def test_storage_reports_an_absent_repo_root_as_missing_not_empty(
    test_client: AsyncClient,
    admin_auth_headers: dict[str, str],
    override_service: FakeGitService,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Zero bytes used would read as a healthy empty disk."""
    monkeypatch.setattr(
        "app.services.admin_stats_service.settings.REPO_ROOT_DIR",
        "/nonexistent-mount-xyz",
    )

    response = await test_client.get("/api/v1/admin/storage", headers=admin_auth_headers)

    assert response.json()["disk"]["exists"] is False


async def test_storage_counts_measured_and_unmeasured_repos_separately(
    test_client: AsyncClient,
    db_session: AsyncSession,
    admin_auth_headers: dict[str, str],
    test_user: User,
    override_service: FakeGitService,
) -> None:
    collection = await _collection(db_session, test_user)
    await _repo(db_session, collection, name="measured", size_bytes=500, git_size_bytes=200)
    await _repo(db_session, collection, name="never-measured")

    response = await test_client.get("/api/v1/admin/storage", headers=admin_auth_headers)

    clones = response.json()["clones"]
    assert clones["measured_repos"] == 1
    assert clones["unmeasured_repos"] == 1
    assert clones["total_bytes"] == 500


# ---------------------------------------------------------------------------
# Drift
# ---------------------------------------------------------------------------


async def test_storage_reports_a_directory_with_no_repo_row(
    test_client: AsyncClient,
    admin_auth_headers: dict[str, str],
    override_service: FakeGitService,
) -> None:
    """Every removed repo leaves its clone behind; this is the only report."""
    override_service.directories = ["/repos/coll/abandoned"]

    response = await test_client.get("/api/v1/admin/storage", headers=admin_auth_headers)

    drift = response.json()["drift"]
    assert [d["path"] for d in drift["orphan_directories"]] == ["/repos/coll/abandoned"]


async def test_storage_reports_a_repo_row_whose_clone_is_gone(
    test_client: AsyncClient,
    db_session: AsyncSession,
    admin_auth_headers: dict[str, str],
    test_user: User,
    override_service: FakeGitService,
) -> None:
    collection = await _collection(db_session, test_user)
    await _repo(db_session, collection, name="gone", local_path="/repos/coll/gone")

    response = await test_client.get("/api/v1/admin/storage", headers=admin_auth_headers)

    missing = response.json()["drift"]["missing_clones"]
    assert [m["repo_name"] for m in missing] == ["gone"]


async def test_storage_reports_a_null_local_path_as_missing(
    test_client: AsyncClient,
    db_session: AsyncSession,
    admin_auth_headers: dict[str, str],
    test_user: User,
    override_service: FakeGitService,
) -> None:
    collection = await _collection(db_session, test_user)
    await _repo(db_session, collection, name="never-cloned", local_path=None)

    response = await test_client.get("/api/v1/admin/storage", headers=admin_auth_headers)

    missing = response.json()["drift"]["missing_clones"]
    assert [m["repo_name"] for m in missing] == ["never-cloned"]


async def test_storage_drift_is_clean_when_disk_and_database_agree(
    test_client: AsyncClient,
    db_session: AsyncSession,
    admin_auth_headers: dict[str, str],
    test_user: User,
    override_service: FakeGitService,
) -> None:
    collection = await _collection(db_session, test_user)
    await _repo(db_session, collection, name="ok", local_path="/repos/coll/ok")
    override_service.directories = ["/repos/coll/ok"]

    response = await test_client.get("/api/v1/admin/storage", headers=admin_auth_headers)

    drift = response.json()["drift"]
    assert drift["orphan_directories"] == []
    assert drift["missing_clones"] == []


async def test_storage_does_not_size_orphans_by_default(
    test_client: AsyncClient,
    admin_auth_headers: dict[str, str],
    override_service: FakeGitService,
) -> None:
    """One abandoned multi-gigabyte clone must not stall the default load."""
    override_service.directories = ["/repos/coll/abandoned"]

    response = await test_client.get("/api/v1/admin/storage", headers=admin_auth_headers)

    assert response.json()["drift"]["orphan_bytes"] is None
    assert override_service.size_calls == []


async def test_storage_sizes_orphans_when_asked(
    test_client: AsyncClient,
    admin_auth_headers: dict[str, str],
    override_service: FakeGitService,
) -> None:
    override_service.directories = ["/repos/coll/abandoned"]
    override_service.sizes = {
        "/repos/coll/abandoned": {"total": 4096, "git": 3000, "worktree": 1096}
    }

    response = await test_client.get(
        "/api/v1/admin/storage?include_orphan_size=true", headers=admin_auth_headers
    )

    assert response.json()["drift"]["orphan_bytes"] == 4096
    assert override_service.size_calls == ["/repos/coll/abandoned"]


# ---------------------------------------------------------------------------
# GET /admin/storage/repos
# ---------------------------------------------------------------------------


async def test_repo_storage_uses_the_house_pagination_envelope(
    test_client: AsyncClient,
    admin_auth_headers: dict[str, str],
    override_service: FakeGitService,
) -> None:
    response = await test_client.get(
        "/api/v1/admin/storage/repos", headers=admin_auth_headers
    )

    assert set(response.json()) == {"items", "total", "limit", "offset"}


async def test_repo_storage_sorts_largest_first_with_unmeasured_last(
    test_client: AsyncClient,
    db_session: AsyncSession,
    admin_auth_headers: dict[str, str],
    test_user: User,
    override_service: FakeGitService,
) -> None:
    collection = await _collection(db_session, test_user)
    await _repo(db_session, collection, name="small", size_bytes=10)
    await _repo(db_session, collection, name="big", size_bytes=900)
    await _repo(db_session, collection, name="unmeasured")

    response = await test_client.get(
        "/api/v1/admin/storage/repos", headers=admin_auth_headers
    )

    assert [i["name"] for i in response.json()["items"]] == [
        "big",
        "small",
        "unmeasured",
    ]


async def test_repo_storage_derives_worktree_bytes(
    test_client: AsyncClient,
    db_session: AsyncSession,
    admin_auth_headers: dict[str, str],
    test_user: User,
    override_service: FakeGitService,
) -> None:
    collection = await _collection(db_session, test_user)
    await _repo(
        db_session, collection, name="r", size_bytes=1000, git_size_bytes=750
    )

    response = await test_client.get(
        "/api/v1/admin/storage/repos", headers=admin_auth_headers
    )

    assert response.json()["items"][0]["worktree_bytes"] == 250


async def test_repo_storage_paginates_in_sql(
    test_client: AsyncClient,
    db_session: AsyncSession,
    admin_auth_headers: dict[str, str],
    test_user: User,
    override_service: FakeGitService,
) -> None:
    collection = await _collection(db_session, test_user)
    for index in range(3):
        await _repo(db_session, collection, name=f"r{index}", size_bytes=index * 100)

    response = await test_client.get(
        "/api/v1/admin/storage/repos?limit=2&offset=2", headers=admin_auth_headers
    )

    body = response.json()
    assert len(body["items"]) == 1
    assert body["total"] == 3
    assert body["limit"] == 2
    assert body["offset"] == 2


async def test_repo_storage_filters_by_collection(
    test_client: AsyncClient,
    db_session: AsyncSession,
    admin_auth_headers: dict[str, str],
    test_user: User,
    override_service: FakeGitService,
) -> None:
    keep = await _collection(db_session, test_user)
    other = await _collection(db_session, test_user)
    await _repo(db_session, keep, name="keep-me", size_bytes=1)
    await _repo(db_session, other, name="not-me", size_bytes=2)

    response = await test_client.get(
        f"/api/v1/admin/storage/repos?collection_id={keep.id}",
        headers=admin_auth_headers,
    )

    body = response.json()
    assert body["total"] == 1
    assert body["items"][0]["name"] == "keep-me"


async def test_repo_storage_rejects_an_unknown_sort(
    test_client: AsyncClient,
    admin_auth_headers: dict[str, str],
    override_service: FakeGitService,
) -> None:
    response = await test_client.get(
        "/api/v1/admin/storage/repos?sort=drop_table", headers=admin_auth_headers
    )

    assert response.status_code == 422


# ---------------------------------------------------------------------------
# POST /admin/storage/recalculate
# ---------------------------------------------------------------------------


async def test_recalculate_measures_and_persists(
    test_client: AsyncClient,
    db_session: AsyncSession,
    admin_auth_headers: dict[str, str],
    test_user: User,
    override_service: FakeGitService,
) -> None:
    collection = await _collection(db_session, test_user)
    await _repo(db_session, collection, name="a", local_path="/repos/c/a")
    override_service.sizes = {
        "/repos/c/a": {"total": 2048, "git": 1024, "worktree": 1024}
    }

    response = await test_client.post(
        "/api/v1/admin/storage/recalculate", headers=admin_auth_headers
    )

    assert response.status_code == 200
    body = response.json()
    assert body["requested"] == 1
    assert body["measured"] == 1
    assert body["skipped_missing"] == 0
    assert body["total_bytes"] == 2048


async def test_recalculate_has_already_written_when_it_responds(
    test_client: AsyncClient,
    db_session: AsyncSession,
    admin_auth_headers: dict[str, str],
    test_user: User,
    override_service: FakeGitService,
) -> None:
    """Pins 'synchronous'. A BackgroundTasks implementation fails this."""
    collection = await _collection(db_session, test_user)
    await _repo(db_session, collection, name="a", local_path="/repos/c/a")
    override_service.sizes = {
        "/repos/c/a": {"total": 2048, "git": 1024, "worktree": 1024}
    }

    await test_client.post(
        "/api/v1/admin/storage/recalculate", headers=admin_auth_headers
    )
    listed = await test_client.get(
        "/api/v1/admin/storage/repos", headers=admin_auth_headers
    )

    item = listed.json()["items"][0]
    assert item["size_bytes"] == 2048
    assert item["size_computed_at"] is not None


async def test_recalculate_counts_a_missing_clone_as_skipped_not_failed(
    test_client: AsyncClient,
    db_session: AsyncSession,
    admin_auth_headers: dict[str, str],
    test_user: User,
    override_service: FakeGitService,
) -> None:
    collection = await _collection(db_session, test_user)
    await _repo(db_session, collection, name="gone", local_path="/repos/c/gone")

    response = await test_client.post(
        "/api/v1/admin/storage/recalculate", headers=admin_auth_headers
    )

    body = response.json()
    assert body["skipped_missing"] == 1
    assert body["failed"] == 0
    assert body["measured"] == 0


async def test_recalculate_keeps_a_previous_measurement_when_the_clone_vanishes(
    test_client: AsyncClient,
    db_session: AsyncSession,
    admin_auth_headers: dict[str, str],
    test_user: User,
    override_service: FakeGitService,
) -> None:
    """An unmounted volume must not wipe the fleet's measurement history."""
    collection = await _collection(db_session, test_user)
    await _repo(
        db_session,
        collection,
        name="gone",
        local_path="/repos/c/gone",
        size_bytes=777,
        git_size_bytes=500,
        size_computed_at=datetime.now(timezone.utc),
    )

    await test_client.post(
        "/api/v1/admin/storage/recalculate", headers=admin_auth_headers
    )
    listed = await test_client.get(
        "/api/v1/admin/storage/repos", headers=admin_auth_headers
    )

    assert listed.json()["items"][0]["size_bytes"] == 777


async def test_recalculate_can_be_scoped_to_a_collection(
    test_client: AsyncClient,
    db_session: AsyncSession,
    admin_auth_headers: dict[str, str],
    test_user: User,
    override_service: FakeGitService,
) -> None:
    keep = await _collection(db_session, test_user)
    other = await _collection(db_session, test_user)
    await _repo(db_session, keep, name="in-scope", local_path="/repos/c/in")
    await _repo(db_session, other, name="out-of-scope", local_path="/repos/c/out")
    override_service.sizes = {
        "/repos/c/in": {"total": 100, "git": 50, "worktree": 50},
        "/repos/c/out": {"total": 200, "git": 50, "worktree": 150},
    }

    response = await test_client.post(
        "/api/v1/admin/storage/recalculate",
        headers=admin_auth_headers,
        json={"collection_id": str(keep.id)},
    )

    body = response.json()
    assert body["requested"] == 1
    assert body["measured"] == 1
    assert override_service.size_calls == ["/repos/c/in"]


async def test_recalculate_returns_zeros_on_an_instance_with_no_repos(
    test_client: AsyncClient,
    admin_auth_headers: dict[str, str],
    override_service: FakeGitService,
) -> None:
    response = await test_client.post(
        "/api/v1/admin/storage/recalculate", headers=admin_auth_headers
    )

    body = response.json()
    assert body["requested"] == 0
    assert body["measured"] == 0
    assert body["total_bytes"] == 0
