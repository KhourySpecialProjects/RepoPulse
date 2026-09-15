"""Every LLM entry point refuses a user who has spent their monthly tokens,
and charges the ones it does spend.

Three routes reach an LLM: summary generation, collection commit-quality and
repo commit-classification. A quota enforced at two of three is not a quota —
the third becomes the way around it — so all three are pinned here.
"""
from __future__ import annotations

import json
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import create_access_token
from app.models.collection import Collection
from app.models.llm_token_usage import LlmTokenUsage, current_period
from app.models.repo import Repo
from app.models.user import User


@pytest_asyncio.fixture
async def capped_user(db_session: AsyncSession) -> User:
    """An instructor with a 1,000-token monthly allowance."""
    user = User(
        id=uuid.uuid4(),
        email=f"capped-{uuid.uuid4().hex[:8]}@example.com",
        display_name="Capped Instructor",
        role="instructor",
        github_token="ghp_capped",
        monthly_token_limit=1_000,
    )
    db_session.add(user)
    await db_session.flush()
    return user


@pytest.fixture
def capped_headers(capped_user: User) -> dict[str, str]:
    token = create_access_token({"sub": str(capped_user.id)})
    return {"Authorization": f"Bearer {token}"}


async def _exhaust(db: AsyncSession, user: User, amount: int = 1_000) -> None:
    db.add(
        LlmTokenUsage(
            user_id=user.id,
            period=current_period(),
            feature="summary",
            model_used="claude-test",
            input_tokens=amount,
            output_tokens=0,
            total_tokens=amount,
        )
    )
    await db.flush()


async def _make_collection(db: AsyncSession, owner_id: uuid.UUID) -> Collection:
    collection = Collection(
        id=uuid.uuid4(),
        name="Quota Collection",
        local_folder_name=f"quota-{uuid.uuid4().hex[:8]}",
        owner_id=owner_id,
    )
    db.add(collection)
    await db.flush()
    return collection


async def _make_repo(db: AsyncSession, collection_id: uuid.UUID) -> Repo:
    repo = Repo(
        id=uuid.uuid4(),
        collection_id=collection_id,
        name="quota-repo",
        github_url="https://github.com/example/quota-repo",
        local_path="/fake/path/quota-repo",
    )
    db.add(repo)
    await db.flush()
    return repo


def _llm_returning(text: str, input_tokens: int, output_tokens: int) -> AsyncMock:
    """A stand-in adapter that reports real-looking token counts.

    Not an AsyncMock alone: a bare mock's `.usage` is another Mock, and the
    point of these tests is that the number written to llm_token_usage is the
    number the adapter reported.
    """
    from app.services.llm.base import TokenUsage

    llm = AsyncMock()
    usage = TokenUsage()

    async def generate(*args: object, **kwargs: object) -> str:
        usage.add(input_tokens, output_tokens)
        return text

    llm.generate = generate
    llm.usage = usage
    return llm


async def _usage_rows(db: AsyncSession, user: User) -> list[LlmTokenUsage]:
    result = await db.execute(
        select(LlmTokenUsage).where(LlmTokenUsage.user_id == user.id)
    )
    return list(result.scalars().all())


# ── Summary generation ───────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_summary_refused_once_the_quota_is_spent(
    test_client: AsyncClient,
    db_session: AsyncSession,
    capped_user: User,
    capped_headers: dict[str, str],
) -> None:
    collection = await _make_collection(db_session, capped_user.id)
    repo = await _make_repo(db_session, collection.id)
    await _exhaust(db_session, capped_user)

    response = await test_client.post(
        "/api/v1/summaries/generate",
        headers=capped_headers,
        json={"summary_type": "repo_overview", "repo_id": str(repo.id)},
    )

    assert response.status_code == 429
    body = response.json()
    assert body["error_code"] == "token_limit_exceeded"
    # The user needs to know how much and until when, not just "no".
    assert body["limit"] == 1_000
    assert body["used"] == 1_000
    assert body["period"] == current_period()


@pytest.mark.asyncio
async def test_summary_makes_no_llm_call_when_refused(
    test_client: AsyncClient,
    db_session: AsyncSession,
    capped_user: User,
    capped_headers: dict[str, str],
) -> None:
    """The refusal has to come before the spend, or it is only a warning."""
    collection = await _make_collection(db_session, capped_user.id)
    repo = await _make_repo(db_session, collection.id)
    await _exhaust(db_session, capped_user)

    with patch("app.api.routes.summaries.get_llm_service") as factory:
        response = await test_client.post(
            "/api/v1/summaries/generate",
            headers=capped_headers,
            json={"summary_type": "repo_overview", "repo_id": str(repo.id)},
        )

    assert response.status_code == 429
    factory.assert_not_called()


@pytest.mark.asyncio
async def test_summary_charges_the_tokens_it_spends(
    test_client: AsyncClient,
    db_session: AsyncSession,
    capped_user: User,
    capped_headers: dict[str, str],
) -> None:
    collection = await _make_collection(db_session, capped_user.id)
    repo = await _make_repo(db_session, collection.id)

    with (
        patch(
            "app.api.routes.summaries._git_service.parse_commits",
            new_callable=AsyncMock,
            return_value=[],
        ),
        patch("app.api.routes.summaries.get_llm_service") as factory,
    ):
        factory.return_value = _llm_returning("A summary.", 300, 120)
        response = await test_client.post(
            "/api/v1/summaries/generate",
            headers=capped_headers,
            json={"summary_type": "repo_overview", "repo_id": str(repo.id)},
        )

    assert response.status_code == 201

    rows = await _usage_rows(db_session, capped_user)
    assert len(rows) == 1
    assert rows[0].input_tokens == 300
    assert rows[0].output_tokens == 120
    assert rows[0].total_tokens == 420
    assert rows[0].feature == "summary"


@pytest.mark.asyncio
async def test_summary_allowed_when_under_the_limit(
    test_client: AsyncClient,
    db_session: AsyncSession,
    capped_user: User,
    capped_headers: dict[str, str],
) -> None:
    collection = await _make_collection(db_session, capped_user.id)
    repo = await _make_repo(db_session, collection.id)
    await _exhaust(db_session, capped_user, amount=999)

    with (
        patch(
            "app.api.routes.summaries._git_service.parse_commits",
            new_callable=AsyncMock,
            return_value=[],
        ),
        patch("app.api.routes.summaries.get_llm_service") as factory,
    ):
        factory.return_value = _llm_returning("A summary.", 10, 5)
        response = await test_client.post(
            "/api/v1/summaries/generate",
            headers=capped_headers,
            json={"summary_type": "repo_overview", "repo_id": str(repo.id)},
        )

    assert response.status_code == 201


@pytest.mark.asyncio
async def test_admin_is_not_metered(
    test_client: AsyncClient,
    db_session: AsyncSession,
    admin_user: User,
    admin_auth_headers: dict[str, str],
) -> None:
    """An admin holding a spent allowance would be unable to raise it."""
    collection = await _make_collection(db_session, admin_user.id)
    repo = await _make_repo(db_session, collection.id)
    admin_user.monthly_token_limit = 10
    await _exhaust(db_session, admin_user, amount=5_000)

    with (
        patch(
            "app.api.routes.summaries._git_service.parse_commits",
            new_callable=AsyncMock,
            return_value=[],
        ),
        patch("app.api.routes.summaries.get_llm_service") as factory,
    ):
        factory.return_value = _llm_returning("A summary.", 10, 5)
        response = await test_client.post(
            "/api/v1/summaries/generate",
            headers=admin_auth_headers,
            json={"summary_type": "repo_overview", "repo_id": str(repo.id)},
        )

    assert response.status_code == 201


@pytest.mark.asyncio
async def test_last_months_spend_does_not_block_this_month(
    test_client: AsyncClient,
    db_session: AsyncSession,
    capped_user: User,
    capped_headers: dict[str, str],
) -> None:
    """A calendar-month quota that never resets is a lifetime quota."""
    collection = await _make_collection(db_session, capped_user.id)
    repo = await _make_repo(db_session, collection.id)
    db_session.add(
        LlmTokenUsage(
            user_id=capped_user.id,
            period="1999-01",
            feature="summary",
            model_used="claude-test",
            input_tokens=9_999,
            output_tokens=0,
            total_tokens=9_999,
        )
    )
    await db_session.flush()

    with (
        patch(
            "app.api.routes.summaries._git_service.parse_commits",
            new_callable=AsyncMock,
            return_value=[],
        ),
        patch("app.api.routes.summaries.get_llm_service") as factory,
    ):
        factory.return_value = _llm_returning("A summary.", 10, 5)
        response = await test_client.post(
            "/api/v1/summaries/generate",
            headers=capped_headers,
            json={"summary_type": "repo_overview", "repo_id": str(repo.id)},
        )

    assert response.status_code == 201


# ── Commit quality ───────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_commit_quality_refused_once_the_quota_is_spent(
    test_client: AsyncClient,
    db_session: AsyncSession,
    capped_user: User,
    capped_headers: dict[str, str],
) -> None:
    collection = await _make_collection(db_session, capped_user.id)
    await _make_repo(db_session, collection.id)
    await _exhaust(db_session, capped_user)

    response = await test_client.get(
        f"/api/v1/collections/{collection.id}/commit-quality",
        headers=capped_headers,
    )

    assert response.status_code == 429
    assert response.json()["error_code"] == "token_limit_exceeded"


@pytest.mark.asyncio
async def test_commit_quality_charges_the_tokens_it_spends(
    test_client: AsyncClient,
    db_session: AsyncSession,
    capped_user: User,
    capped_headers: dict[str, str],
) -> None:
    collection = await _make_collection(db_session, capped_user.id)
    await _make_repo(db_session, collection.id)

    commits = [
        {
            "hash": "abc1234",
            "full_hash": "abc1234abc1234abc1234abc1234abc1234abc12",
            "message": "Fix null pointer in auth service",
            "author": "Alice",
            "date": "2026-01-01T10:00:00",
        }
    ]

    with (
        patch(
            "app.api.routes.commit_quality._git_service.get_recent_commits",
            new_callable=AsyncMock,
            return_value=commits,
        ),
        patch(
            "app.services.commit_classifier_service.get_llm_service"
        ) as factory,
    ):
        factory.return_value = _llm_returning(
            json.dumps([{"i": 0, "s": "good"}]), 800, 40
        )
        response = await test_client.get(
            f"/api/v1/collections/{collection.id}/commit-quality",
            headers=capped_headers,
        )

    assert response.status_code == 200

    rows = await _usage_rows(db_session, capped_user)
    assert len(rows) == 1
    assert rows[0].total_tokens == 840
    assert rows[0].feature == "commit_quality"


@pytest.mark.asyncio
async def test_a_fully_cached_request_is_charged_nothing(
    test_client: AsyncClient,
    db_session: AsyncSession,
    capped_user: User,
    capped_headers: dict[str, str],
) -> None:
    """No call, no charge — and no 0-token row implying a call happened."""
    collection = await _make_collection(db_session, capped_user.id)

    with patch(
        "app.api.routes.commit_quality._git_service.get_recent_commits",
        new_callable=AsyncMock,
        return_value=[],
    ):
        response = await test_client.get(
            f"/api/v1/collections/{collection.id}/commit-quality",
            headers=capped_headers,
        )

    assert response.status_code == 200
    assert await _usage_rows(db_session, capped_user) == []


# ── My own usage ─────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_a_user_can_read_their_own_usage(
    test_client: AsyncClient,
    db_session: AsyncSession,
    capped_user: User,
    capped_headers: dict[str, str],
) -> None:
    """A 429 with no way to see the number behind it is a dead end."""
    await _exhaust(db_session, capped_user, amount=250)

    response = await test_client.get(
        "/api/v1/settings/token-usage", headers=capped_headers
    )

    assert response.status_code == 200
    body = response.json()
    assert body["used"] == 250
    assert body["limit"] == 1_000
    assert body["remaining"] == 750
    assert body["unlimited"] is False
    assert body["exceeded"] is False
    assert body["period"] == current_period()


@pytest.mark.asyncio
async def test_own_usage_reports_unlimited_for_an_admin(
    test_client: AsyncClient,
    admin_auth_headers: dict[str, str],
) -> None:
    response = await test_client.get(
        "/api/v1/settings/token-usage", headers=admin_auth_headers
    )

    assert response.status_code == 200
    body = response.json()
    assert body["unlimited"] is True
    assert body["limit"] is None
    assert body["remaining"] is None


@pytest.mark.asyncio
async def test_own_usage_requires_a_token(test_client: AsyncClient) -> None:
    response = await test_client.get("/api/v1/settings/token-usage")
    assert response.status_code == 401
