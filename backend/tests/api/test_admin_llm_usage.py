"""GET /api/v1/admin/llm-usage — call volume, deliberately not cost.

Two omissions are load-bearing and are pinned by tests here so nobody
helpfully adds them back:

  * No cost estimate. No token counts are persisted on either table, so any
    spend figure would be rows x assumed-tokens x assumed-price — invented
    inputs producing a number that reads as measured and is wrong by a
    multiple. Phoenix has the real per-span token usage.
  * No failure count. A failed LLM call writes no row, so these tables hold
    only successes; "0 failures" would be a lie by construction.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.collection import Collection
from app.models.commit_classification import CommitClassification
from app.models.repo import Repo
from app.models.summary import Summary
from app.models.user import User


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


async def _repo(db: AsyncSession, collection: Collection) -> Repo:
    slug = uuid.uuid4().hex[:8]
    repo = Repo(
        id=uuid.uuid4(),
        collection_id=collection.id,
        github_url=f"https://github.com/acme/{slug}",
        name=f"repo-{slug}",
    )
    db.add(repo)
    await db.flush()
    return repo


async def _summary(
    db: AsyncSession,
    *,
    repo: Repo | None,
    model: str = "claude-sonnet-5",
    generated_at: datetime | None = None,
) -> Summary:
    summary = Summary(
        id=uuid.uuid4(),
        repo_id=repo.id if repo else None,
        summary_type="repo_overview",
        content="...",
        model_used=model,
        generated_at=generated_at or datetime.now(timezone.utc),
    )
    db.add(summary)
    await db.flush()
    return summary


async def _classification(
    db: AsyncSession,
    repo: Repo,
    *,
    model: str = "claude-sonnet-5",
    scored_at: datetime | None = None,
) -> CommitClassification:
    row = CommitClassification(
        id=uuid.uuid4(),
        repo_id=repo.id,
        commit_hash=uuid.uuid4().hex * 1,
        score="good",
        commit_type="substantive",
        model_used=model,
        # NAIVE on purpose: the column is DateTime without timezone.
        scored_at=scored_at or datetime.utcnow(),
    )
    db.add(row)
    await db.flush()
    return row


async def test_llm_usage_is_empty_on_a_fresh_instance(
    test_client: AsyncClient, admin_auth_headers: dict[str, str]
) -> None:
    response = await test_client.get(
        "/api/v1/admin/llm-usage", headers=admin_auth_headers
    )

    assert response.status_code == 200
    body = response.json()
    assert body["total_calls"] == 0
    assert body["by_model"] == []
    assert body["window_days"] == 30


async def test_llm_usage_groups_summaries_by_model(
    test_client: AsyncClient,
    db_session: AsyncSession,
    admin_auth_headers: dict[str, str],
    test_user: User,
) -> None:
    collection = await _collection(db_session, test_user)
    repo = await _repo(db_session, collection)
    await _summary(db_session, repo=repo, model="claude-sonnet-5")
    await _summary(db_session, repo=repo, model="claude-sonnet-5")
    await _summary(db_session, repo=repo, model="claude-opus-4")

    response = await test_client.get(
        "/api/v1/admin/llm-usage", headers=admin_auth_headers
    )

    by_model = {row["model"]: row["calls"] for row in response.json()["by_model"]}
    assert by_model == {"claude-sonnet-5": 2, "claude-opus-4": 1}


async def test_llm_usage_counts_classifications_alongside_summaries(
    test_client: AsyncClient,
    db_session: AsyncSession,
    admin_auth_headers: dict[str, str],
    test_user: User,
) -> None:
    collection = await _collection(db_session, test_user)
    repo = await _repo(db_session, collection)
    await _summary(db_session, repo=repo)
    await _classification(db_session, repo)

    response = await test_client.get(
        "/api/v1/admin/llm-usage", headers=admin_auth_headers
    )

    body = response.json()
    kinds = {row["kind"] for row in body["by_model"]}
    assert kinds == {"summary", "commit_classification"}
    assert body["total_calls"] == 2


async def test_llm_usage_counts_a_naive_scored_at_correctly(
    test_client: AsyncClient,
    db_session: AsyncSession,
    admin_auth_headers: dict[str, str],
    test_user: User,
) -> None:
    """CommitClassification.scored_at is naive while everything else is aware.

    Comparing it to now() without an explicit cast makes Postgres interpret
    it using the session TimeZone, which is UTC in this container by luck and
    wrong anywhere else. This is the test that catches that.
    """
    collection = await _collection(db_session, test_user)
    repo = await _repo(db_session, collection)
    await _classification(db_session, repo, scored_at=datetime.utcnow())

    response = await test_client.get(
        "/api/v1/admin/llm-usage?days=1", headers=admin_auth_headers
    )

    assert response.json()["total_calls"] == 1


async def test_llm_usage_respects_the_window(
    test_client: AsyncClient,
    db_session: AsyncSession,
    admin_auth_headers: dict[str, str],
    test_user: User,
) -> None:
    collection = await _collection(db_session, test_user)
    repo = await _repo(db_session, collection)
    now = datetime.now(timezone.utc)
    await _summary(db_session, repo=repo, generated_at=now - timedelta(days=40))
    await _summary(db_session, repo=repo, generated_at=now - timedelta(days=1))

    within_30 = await test_client.get(
        "/api/v1/admin/llm-usage?days=30", headers=admin_auth_headers
    )
    within_90 = await test_client.get(
        "/api/v1/admin/llm-usage?days=90", headers=admin_auth_headers
    )

    assert within_30.json()["total_calls"] == 1
    assert within_90.json()["total_calls"] == 2


async def test_llm_usage_attributes_to_the_collection_owner(
    test_client: AsyncClient,
    db_session: AsyncSession,
    admin_auth_headers: dict[str, str],
    test_user: User,
) -> None:
    """Not "by user" — the tables record no requester. This is the closest
    reachable attribution and is named for what it measures."""
    collection = await _collection(db_session, test_user)
    repo = await _repo(db_session, collection)
    await _summary(db_session, repo=repo)
    await _summary(db_session, repo=repo)

    response = await test_client.get(
        "/api/v1/admin/llm-usage", headers=admin_auth_headers
    )

    owners = response.json()["by_collection_owner"]
    assert len(owners) == 1
    assert owners[0]["user_id"] == str(test_user.id)
    assert owners[0]["calls"] == 2


async def test_llm_usage_reports_unattributed_summaries_separately(
    test_client: AsyncClient,
    db_session: AsyncSession,
    admin_auth_headers: dict[str, str],
) -> None:
    """summaries.repo_id is nullable, so the owner join drops those rows.

    Reported rather than silently lost.
    """
    await _summary(db_session, repo=None)

    response = await test_client.get(
        "/api/v1/admin/llm-usage", headers=admin_auth_headers
    )

    body = response.json()
    assert body["unattributed_summaries"] == 1
    assert body["by_collection_owner"] == []
    assert body["total_calls"] == 1


async def test_llm_usage_returns_a_daily_series(
    test_client: AsyncClient,
    db_session: AsyncSession,
    admin_auth_headers: dict[str, str],
    test_user: User,
) -> None:
    collection = await _collection(db_session, test_user)
    repo = await _repo(db_session, collection)
    now = datetime.now(timezone.utc)
    await _summary(db_session, repo=repo, generated_at=now - timedelta(days=2))
    await _summary(db_session, repo=repo, generated_at=now - timedelta(days=2))

    response = await test_client.get(
        "/api/v1/admin/llm-usage", headers=admin_auth_headers
    )

    daily = response.json()["daily"]
    assert len(daily) == 1
    assert daily[0]["calls"] == 2


async def test_llm_usage_flags_models_that_are_not_the_current_default(
    test_client: AsyncClient,
    db_session: AsyncSession,
    admin_auth_headers: dict[str, str],
    test_user: User,
) -> None:
    """The actionable signal, in place of a cost estimate.

    Migration 0002 exists because a retired model id started returning 404s.
    """
    collection = await _collection(db_session, test_user)
    repo = await _repo(db_session, collection)
    await _summary(db_session, repo=repo, model="claude-sonnet-4-20250514")

    response = await test_client.get(
        "/api/v1/admin/llm-usage", headers=admin_auth_headers
    )

    body = response.json()
    assert "claude-sonnet-4-20250514" in body["retired_models_in_use"]
    assert body["current_default_model"] not in body["retired_models_in_use"]


async def test_llm_usage_validates_the_window(
    test_client: AsyncClient, admin_auth_headers: dict[str, str]
) -> None:
    for bad in ("0", "400", "-1"):
        response = await test_client.get(
            f"/api/v1/admin/llm-usage?days={bad}", headers=admin_auth_headers
        )
        assert response.status_code == 422, bad


async def test_llm_usage_reports_no_cost_and_no_failure_count(
    test_client: AsyncClient, admin_auth_headers: dict[str, str]
) -> None:
    """Pins two deliberate omissions.

    Token counts are not persisted, so a spend figure would be fabricated;
    failed calls write no row, so a failure count would always read zero.
    Both are unsupportable, and a number that looks measured is worse than
    an absent one.
    """
    response = await test_client.get(
        "/api/v1/admin/llm-usage", headers=admin_auth_headers
    )

    body = response.json()
    assert not [key for key in body if "cost" in key.lower()]
    assert not [key for key in body if "fail" in key.lower()]
    assert "usd" not in response.text.lower()
