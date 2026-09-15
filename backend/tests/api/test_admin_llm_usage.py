"""GET /api/v1/admin/llm-usage — provider call volume, deliberately not cost.

The endpoint used to count rows in `summaries` and `commit_classifications`,
which are one-per-artefact tables: classifying 222 commits reported 222
"calls" when the classifier had actually made six batched requests. The number
was off by the batch size and moved with how many commits a repo had rather
than with load on the provider.

It now reads `llm_token_usage`, whose rows are written per LLM call with the
counts the provider reported. One click of Classify therefore registers as the
number of batches it sent — the thing an administrator can act on.

Two omissions remain load-bearing and are pinned below:

  * No cost estimate *here*. Tokens are priced on the AI Settings tab, at
    rates an administrator enters; this endpoint answers "how much load", and
    a second spend figure derived from call counts alone would be invented.
  * No failure count. A failed call writes no usage row, so these rows are
    only successes and "0 failures" would be a lie by construction.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.llm_token_usage import (
    FEATURE_COMMIT_CLASSIFICATION,
    FEATURE_COMMIT_QUALITY,
    FEATURE_SUMMARY,
    LlmTokenUsage,
    current_period,
)
from app.models.user import User
from app.services.llm.quota import get_llm_config


async def _usage(
    db: AsyncSession,
    user: User,
    *,
    feature: str = FEATURE_SUMMARY,
    model: str = "claude-sonnet-5",
    calls: int = 1,
    input_tokens: int = 100,
    output_tokens: int = 20,
    created_at: datetime | None = None,
) -> LlmTokenUsage:
    """One usage row: the record a completed LLM request leaves behind."""
    moment = created_at or datetime.now(timezone.utc)
    row = LlmTokenUsage(
        id=uuid.uuid4(),
        user_id=user.id,
        period=current_period(moment),
        feature=feature,
        model_used=model,
        calls=calls,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        total_tokens=input_tokens + output_tokens,
        created_at=moment,
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


async def test_llm_usage_counts_provider_calls_not_rows(
    test_client: AsyncClient,
    db_session: AsyncSession,
    admin_auth_headers: dict[str, str],
    test_user: User,
) -> None:
    """The regression this endpoint was rewritten for.

    One batched Classify run writes a single usage row covering several
    requests. Counting rows reported 1; the answer is 6.
    """
    await _usage(
        db_session,
        test_user,
        feature=FEATURE_COMMIT_CLASSIFICATION,
        calls=6,
    )

    response = await test_client.get(
        "/api/v1/admin/llm-usage", headers=admin_auth_headers
    )

    assert response.json()["total_calls"] == 6


async def test_llm_usage_groups_by_feature_and_model(
    test_client: AsyncClient,
    db_session: AsyncSession,
    admin_auth_headers: dict[str, str],
    test_user: User,
) -> None:
    await _usage(db_session, test_user, feature=FEATURE_SUMMARY, calls=2)
    await _usage(db_session, test_user, feature=FEATURE_SUMMARY, calls=1)
    await _usage(
        db_session, test_user, feature=FEATURE_COMMIT_CLASSIFICATION, calls=6
    )
    await _usage(
        db_session,
        test_user,
        feature=FEATURE_SUMMARY,
        model="claude-opus-4",
        calls=4,
    )

    response = await test_client.get(
        "/api/v1/admin/llm-usage", headers=admin_auth_headers
    )

    body = response.json()
    grouped = {(row["kind"], row["model"]): row["calls"] for row in body["by_model"]}
    assert grouped == {
        ("summary", "claude-sonnet-5"): 3,
        ("commit_classification", "claude-sonnet-5"): 6,
        ("summary", "claude-opus-4"): 4,
    }
    assert body["total_calls"] == 13


async def test_llm_usage_includes_commit_quality(
    test_client: AsyncClient,
    db_session: AsyncSession,
    admin_auth_headers: dict[str, str],
    test_user: User,
) -> None:
    """Three features spend tokens, so all three are call volume.

    The old two-table union could not see commit-quality scoring at all, which
    made the graph's series sum to less than its own total.
    """
    await _usage(db_session, test_user, feature=FEATURE_COMMIT_QUALITY, calls=3)

    response = await test_client.get(
        "/api/v1/admin/llm-usage", headers=admin_auth_headers
    )

    body = response.json()
    assert {row["kind"] for row in body["by_model"]} == {"commit_quality"}
    assert body["total_calls"] == 3
    assert sum(row["calls"] for row in body["by_model"]) == body["total_calls"]


async def test_llm_usage_respects_the_window(
    test_client: AsyncClient,
    db_session: AsyncSession,
    admin_auth_headers: dict[str, str],
    test_user: User,
) -> None:
    now = datetime.now(timezone.utc)
    await _usage(db_session, test_user, calls=5, created_at=now - timedelta(days=40))
    await _usage(db_session, test_user, calls=2, created_at=now - timedelta(days=1))

    within_30 = await test_client.get(
        "/api/v1/admin/llm-usage?days=30", headers=admin_auth_headers
    )
    within_90 = await test_client.get(
        "/api/v1/admin/llm-usage?days=90", headers=admin_auth_headers
    )

    assert within_30.json()["total_calls"] == 2
    assert within_90.json()["total_calls"] == 7


async def test_llm_usage_returns_a_daily_series(
    test_client: AsyncClient,
    db_session: AsyncSession,
    admin_auth_headers: dict[str, str],
    test_user: User,
) -> None:
    now = datetime.now(timezone.utc)
    await _usage(db_session, test_user, calls=2, created_at=now - timedelta(days=2))
    await _usage(db_session, test_user, calls=3, created_at=now - timedelta(days=2))

    response = await test_client.get(
        "/api/v1/admin/llm-usage", headers=admin_auth_headers
    )

    daily = response.json()["daily"]
    assert len(daily) == 1
    assert daily[0]["kind"] == "summary"
    assert daily[0]["calls"] == 5


async def test_llm_usage_splits_the_daily_series_by_kind(
    test_client: AsyncClient,
    db_session: AsyncSession,
    admin_auth_headers: dict[str, str],
    test_user: User,
) -> None:
    """The graph stacks one area per kind, so a day needs one point per kind."""
    now = datetime.now(timezone.utc)
    await _usage(
        db_session, test_user, feature=FEATURE_SUMMARY, calls=1, created_at=now
    )
    await _usage(
        db_session,
        test_user,
        feature=FEATURE_COMMIT_CLASSIFICATION,
        calls=6,
        created_at=now,
    )

    response = await test_client.get(
        "/api/v1/admin/llm-usage", headers=admin_auth_headers
    )

    daily = {point["kind"]: point["calls"] for point in response.json()["daily"]}
    assert daily == {"summary": 1, "commit_classification": 6}


async def test_llm_usage_flags_models_that_are_not_the_configured_one(
    test_client: AsyncClient,
    db_session: AsyncSession,
    admin_auth_headers: dict[str, str],
    test_user: User,
) -> None:
    """The actionable signal, in place of a cost estimate.

    Compared against the instance's configured model rather than the
    environment default: an administrator picks the model on the AI Settings
    tab, and the env var is only the fallback that seeds it. Migration 0002
    exists because a retired model id started returning 404s.
    """
    config = await get_llm_config(db_session)
    config.llm_model = "claude-sonnet-5"
    await db_session.flush()

    await _usage(db_session, test_user, model="claude-sonnet-4-20250514")
    await _usage(db_session, test_user, model="claude-sonnet-5")

    response = await test_client.get(
        "/api/v1/admin/llm-usage", headers=admin_auth_headers
    )

    body = response.json()
    assert body["current_default_model"] == "claude-sonnet-5"
    assert body["retired_models_in_use"] == ["claude-sonnet-4-20250514"]
    assert sorted(body["models_in_use"]) == [
        "claude-sonnet-4-20250514",
        "claude-sonnet-5",
    ]


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

    Spend is priced on the AI Settings tab from real token counts; deriving a
    second figure from call volume would be an invention. Failed calls write
    no row, so a failure count would always read zero.
    """
    response = await test_client.get(
        "/api/v1/admin/llm-usage", headers=admin_auth_headers
    )

    body = response.json()
    assert not [key for key in body if "cost" in key.lower()]
    assert not [key for key in body if "fail" in key.lower()]
    assert "usd" not in response.text.lower()
