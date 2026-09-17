"""The shared LLM config and the token limits are the administrator's alone.

Gating itself is covered by test_admin_auth.py, which enumerates every
/admin route. These tests cover the behaviour behind the gate, plus the one
thing the gate cannot express: that a non-administrator has no other route to
the same data.
"""
from __future__ import annotations

import uuid
from decimal import Decimal

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import create_access_token
from app.core.config import settings
from app.models.llm_config import DEFAULT_MONTHLY_TOKEN_LIMIT, LlmConfig
from app.models.llm_token_usage import LlmTokenUsage, current_period
from app.models.user import User


@pytest_asyncio.fixture
async def other_user(db_session: AsyncSession) -> User:
    user = User(
        id=uuid.uuid4(),
        email=f"other-{uuid.uuid4().hex[:8]}@example.com",
        display_name="Other Instructor",
        role="instructor",
    )
    db_session.add(user)
    await db_session.flush()
    return user


@pytest.fixture
def other_headers(other_user: User) -> dict[str, str]:
    token = create_access_token({"sub": str(other_user.id)})
    return {"Authorization": f"Bearer {token}"}


# ── Reading the config ───────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_config_defaults_come_from_the_environment(
    test_client: AsyncClient, admin_auth_headers: dict[str, str]
) -> None:
    """A fresh instance reports a working model without anyone configuring it."""
    response = await test_client.get(
        "/api/v1/admin/llm-config", headers=admin_auth_headers
    )

    assert response.status_code == 200
    body = response.json()
    assert body["llm_provider"] == settings.DEFAULT_LLM_PROVIDER
    assert body["llm_model"] == settings.DEFAULT_LLM_MODEL
    assert body["default_monthly_token_limit"] == DEFAULT_MONTHLY_TOKEN_LIMIT


@pytest.mark.asyncio
async def test_the_api_key_is_never_echoed_back(
    test_client: AsyncClient, admin_auth_headers: dict[str, str]
) -> None:
    """Reported as a boolean only — not the value, not a prefix, not a length."""
    await test_client.patch(
        "/api/v1/admin/llm-config",
        headers=admin_auth_headers,
        json={"anthropic_api_key": "sk-ant-secret-value"},
    )

    response = await test_client.get(
        "/api/v1/admin/llm-config", headers=admin_auth_headers
    )

    assert response.status_code == 200
    assert "sk-ant-secret-value" not in response.text
    assert response.json()["anthropic_api_key_configured"] is True


# ── Writing the config ───────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_admin_can_change_the_shared_model(
    test_client: AsyncClient, admin_auth_headers: dict[str, str]
) -> None:
    response = await test_client.patch(
        "/api/v1/admin/llm-config",
        headers=admin_auth_headers,
        json={"llm_model": "claude-opus-5"},
    )

    assert response.status_code == 200
    assert response.json()["llm_model"] == "claude-opus-5"


@pytest.mark.asyncio
async def test_a_null_key_clears_it_back_to_the_environment(
    test_client: AsyncClient, admin_auth_headers: dict[str, str]
) -> None:
    """Removing an override has to be possible, or a wrong key is permanent."""
    await test_client.patch(
        "/api/v1/admin/llm-config",
        headers=admin_auth_headers,
        json={"anthropic_api_key": "sk-ant-wrong"},
    )

    response = await test_client.patch(
        "/api/v1/admin/llm-config",
        headers=admin_auth_headers,
        json={"anthropic_api_key": None},
    )

    assert response.status_code == 200
    assert response.json()["anthropic_api_key_configured"] is False


@pytest.mark.asyncio
async def test_an_unknown_provider_is_rejected(
    test_client: AsyncClient, admin_auth_headers: dict[str, str]
) -> None:
    response = await test_client.patch(
        "/api/v1/admin/llm-config",
        headers=admin_auth_headers,
        json={"llm_provider": "openai"},
    )

    assert response.status_code == 422


@pytest.mark.asyncio
async def test_a_negative_default_limit_is_rejected(
    test_client: AsyncClient, admin_auth_headers: dict[str, str]
) -> None:
    response = await test_client.patch(
        "/api/v1/admin/llm-config",
        headers=admin_auth_headers,
        json={"default_monthly_token_limit": -1},
    )

    assert response.status_code == 422


@pytest.mark.asyncio
async def test_a_zero_default_limit_is_allowed(
    test_client: AsyncClient, admin_auth_headers: dict[str, str]
) -> None:
    """0 revokes AI features instance-wide, which is a legitimate thing to want."""
    response = await test_client.patch(
        "/api/v1/admin/llm-config",
        headers=admin_auth_headers,
        json={"default_monthly_token_limit": 0},
    )

    assert response.status_code == 200
    assert response.json()["default_monthly_token_limit"] == 0


@pytest.mark.asyncio
async def test_repeated_writes_leave_one_config_row(
    test_client: AsyncClient,
    db_session: AsyncSession,
    admin_auth_headers: dict[str, str],
) -> None:
    """Two rows would mean two users on two models with no way to tell which."""
    for model in ("claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5"):
        await test_client.patch(
            "/api/v1/admin/llm-config",
            headers=admin_auth_headers,
            json={"llm_model": model},
        )

    rows = (await db_session.execute(select(LlmConfig))).scalars().all()
    assert len(rows) == 1


# ── The config is not reachable any other way ────────────────────────────────


@pytest.mark.asyncio
async def test_a_non_admin_cannot_set_a_key_through_user_settings(
    test_client: AsyncClient,
    db_session: AsyncSession,
    other_headers: dict[str, str],
) -> None:
    """The old per-user field must not still work by another name.

    PATCH /settings ignores unknown keys rather than rejecting them, so the
    assertion that matters is about the effect, not the status code.
    """
    response = await test_client.patch(
        "/api/v1/settings",
        headers=other_headers,
        json={
            "anthropic_api_key": "sk-ant-sneaky",
            "llm_model": "claude-opus-5",
            "llm_provider": "ollama",
        },
    )

    assert response.status_code == 200
    config = (await db_session.execute(select(LlmConfig))).scalar_one_or_none()
    if config is not None:
        assert config.anthropic_api_key != "sk-ant-sneaky"
        assert config.llm_provider != "ollama"


@pytest.mark.asyncio
async def test_user_settings_reports_the_model_read_only(
    test_client: AsyncClient,
    admin_auth_headers: dict[str, str],
    other_headers: dict[str, str],
) -> None:
    """A user should see which model will run, without being able to pick it."""
    await test_client.patch(
        "/api/v1/admin/llm-config",
        headers=admin_auth_headers,
        json={"llm_model": "claude-opus-5"},
    )

    response = await test_client.get("/api/v1/settings", headers=other_headers)

    assert response.status_code == 200
    body = response.json()
    assert body["llm_model"] == "claude-opus-5"
    # The fields that used to let a user hold their own key are gone.
    assert "anthropic_api_key_configured" not in body
    assert "llm_provider" not in body


# ── Per-user token limits ────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_usage_table_lists_users_with_their_effective_limits(
    test_client: AsyncClient,
    db_session: AsyncSession,
    admin_auth_headers: dict[str, str],
    other_user: User,
) -> None:
    db_session.add(
        LlmTokenUsage(
            user_id=other_user.id,
            period=current_period(),
            feature="summary",
            model_used="claude-test",
            input_tokens=700,
            output_tokens=300,
            total_tokens=1_000,
        )
    )
    await db_session.flush()

    response = await test_client.get(
        "/api/v1/admin/token-usage", headers=admin_auth_headers
    )

    assert response.status_code == 200
    body = response.json()
    assert body["period"] == current_period()
    assert {"items", "total", "limit", "offset"} <= set(body)

    row = next(i for i in body["items"] if i["user_id"] == str(other_user.id))
    assert row["used"] == 1_000
    assert row["limit"] == DEFAULT_MONTHLY_TOKEN_LIMIT
    # Following the default is distinct from having been set to it.
    assert row["override"] is None
    assert row["unlimited"] is False


@pytest.mark.asyncio
async def test_usage_table_marks_admins_unlimited(
    test_client: AsyncClient,
    admin_auth_headers: dict[str, str],
    admin_user: User,
) -> None:
    response = await test_client.get(
        "/api/v1/admin/token-usage", headers=admin_auth_headers
    )

    row = next(
        i
        for i in response.json()["items"]
        if i["user_id"] == str(admin_user.id)
    )
    assert row["unlimited"] is True
    assert row["limit"] is None


@pytest.mark.asyncio
async def test_admin_can_set_a_per_user_override(
    test_client: AsyncClient,
    db_session: AsyncSession,
    admin_auth_headers: dict[str, str],
    other_user: User,
) -> None:
    response = await test_client.patch(
        f"/api/v1/admin/users/{other_user.id}/token-limit",
        headers=admin_auth_headers,
        json={"monthly_token_limit": 2_500},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["override"] == 2_500
    assert body["limit"] == 2_500

    await db_session.refresh(other_user)
    assert other_user.monthly_token_limit == 2_500


@pytest.mark.asyncio
async def test_a_null_override_returns_the_user_to_the_default(
    test_client: AsyncClient,
    admin_auth_headers: dict[str, str],
    other_user: User,
) -> None:
    await test_client.patch(
        f"/api/v1/admin/users/{other_user.id}/token-limit",
        headers=admin_auth_headers,
        json={"monthly_token_limit": 10},
    )

    response = await test_client.patch(
        f"/api/v1/admin/users/{other_user.id}/token-limit",
        headers=admin_auth_headers,
        json={"monthly_token_limit": None},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["override"] is None
    assert body["limit"] == DEFAULT_MONTHLY_TOKEN_LIMIT


@pytest.mark.asyncio
async def test_an_override_of_zero_is_kept_not_treated_as_unset(
    test_client: AsyncClient,
    admin_auth_headers: dict[str, str],
    other_user: User,
) -> None:
    """Revoking one user's AI access is the reason per-user limits exist."""
    response = await test_client.patch(
        f"/api/v1/admin/users/{other_user.id}/token-limit",
        headers=admin_auth_headers,
        json={"monthly_token_limit": 0},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["override"] == 0
    assert body["limit"] == 0
    assert body["exceeded"] is True


@pytest.mark.asyncio
async def test_a_negative_override_is_rejected(
    test_client: AsyncClient,
    admin_auth_headers: dict[str, str],
    other_user: User,
) -> None:
    response = await test_client.patch(
        f"/api/v1/admin/users/{other_user.id}/token-limit",
        headers=admin_auth_headers,
        json={"monthly_token_limit": -5},
    )

    assert response.status_code == 422


@pytest.mark.asyncio
async def test_setting_a_limit_on_an_unknown_user_is_404(
    test_client: AsyncClient, admin_auth_headers: dict[str, str]
) -> None:
    response = await test_client.patch(
        f"/api/v1/admin/users/{uuid.uuid4()}/token-limit",
        headers=admin_auth_headers,
        json={"monthly_token_limit": 100},
    )

    assert response.status_code == 404


@pytest.mark.asyncio
async def test_raising_the_limit_unblocks_a_spent_user(
    test_client: AsyncClient,
    db_session: AsyncSession,
    admin_auth_headers: dict[str, str],
    other_user: User,
    other_headers: dict[str, str],
) -> None:
    """The whole point of the admin control: a blocked user can be let back in."""
    other_user.monthly_token_limit = 100
    db_session.add(
        LlmTokenUsage(
            user_id=other_user.id,
            period=current_period(),
            feature="summary",
            model_used="claude-test",
            input_tokens=100,
            output_tokens=0,
            total_tokens=100,
        )
    )
    await db_session.flush()

    before = await test_client.get(
        "/api/v1/settings/token-usage", headers=other_headers
    )
    assert before.json()["exceeded"] is True

    await test_client.patch(
        f"/api/v1/admin/users/{other_user.id}/token-limit",
        headers=admin_auth_headers,
        json={"monthly_token_limit": 5_000},
    )

    after = await test_client.get(
        "/api/v1/settings/token-usage", headers=other_headers
    )
    assert after.json()["exceeded"] is False
    assert after.json()["remaining"] == 4_900


# ── Token usage and cost summary ─────────────────────────────────────────────


async def _spend(
    db: AsyncSession,
    user: User,
    *,
    input_tokens: int,
    output_tokens: int,
    model: str = "claude-sonnet-5",
) -> None:
    db.add(
        LlmTokenUsage(
            user_id=user.id,
            period=current_period(),
            feature="summary",
            model_used=model,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            total_tokens=input_tokens + output_tokens,
        )
    )
    await db.flush()


@pytest.mark.asyncio
async def test_summary_totals_the_measured_tokens(
    test_client: AsyncClient,
    db_session: AsyncSession,
    admin_auth_headers: dict[str, str],
    other_user: User,
) -> None:
    await _spend(db_session, other_user, input_tokens=1_000, output_tokens=200)
    await _spend(db_session, other_user, input_tokens=500, output_tokens=100)

    response = await test_client.get(
        "/api/v1/admin/token-usage/summary", headers=admin_auth_headers
    )

    assert response.status_code == 200
    body = response.json()
    assert body["input_tokens"] == 1_500
    assert body["output_tokens"] == 300
    assert body["total_tokens"] == 1_800
    assert body["calls"] == 2
    assert body["period"] == current_period()


@pytest.mark.asyncio
async def test_summary_excludes_other_periods(
    test_client: AsyncClient,
    db_session: AsyncSession,
    admin_auth_headers: dict[str, str],
    other_user: User,
) -> None:
    db_session.add(
        LlmTokenUsage(
            user_id=other_user.id,
            period="1999-01",
            feature="summary",
            model_used="claude-sonnet-5",
            input_tokens=9_999,
            output_tokens=9_999,
            total_tokens=19_998,
        )
    )
    await db_session.flush()

    response = await test_client.get(
        "/api/v1/admin/token-usage/summary", headers=admin_auth_headers
    )

    assert response.json()["total_tokens"] == 0


@pytest.mark.asyncio
async def test_cost_is_null_until_rates_are_set(
    test_client: AsyncClient,
    db_session: AsyncSession,
    admin_auth_headers: dict[str, str],
    other_user: User,
) -> None:
    """A fresh instance has no rates, so its cost is unknown — not zero."""
    await _spend(db_session, other_user, input_tokens=1_000_000, output_tokens=0)

    response = await test_client.get(
        "/api/v1/admin/token-usage/summary", headers=admin_auth_headers
    )

    assert response.json()["estimated_cost_usd"] is None


@pytest.mark.asyncio
async def test_cost_appears_once_an_admin_enters_rates(
    test_client: AsyncClient,
    db_session: AsyncSession,
    admin_auth_headers: dict[str, str],
    other_user: User,
) -> None:
    await _spend(
        db_session, other_user, input_tokens=2_000_000, output_tokens=100_000
    )

    await test_client.patch(
        "/api/v1/admin/llm-config",
        headers=admin_auth_headers,
        json={"input_price_per_mtok": "3.00", "output_price_per_mtok": "15.00"},
    )

    response = await test_client.get(
        "/api/v1/admin/token-usage/summary", headers=admin_auth_headers
    )

    # 2 x $3.00 + 0.1 x $15.00
    assert Decimal(response.json()["estimated_cost_usd"]) == Decimal("7.5000")


@pytest.mark.asyncio
async def test_rates_round_trip_through_the_config(
    test_client: AsyncClient, admin_auth_headers: dict[str, str]
) -> None:
    await test_client.patch(
        "/api/v1/admin/llm-config",
        headers=admin_auth_headers,
        json={"input_price_per_mtok": "0.80", "output_price_per_mtok": "4.00"},
    )

    response = await test_client.get(
        "/api/v1/admin/llm-config", headers=admin_auth_headers
    )

    body = response.json()
    assert Decimal(body["input_price_per_mtok"]) == Decimal("0.80")
    assert Decimal(body["output_price_per_mtok"]) == Decimal("4.00")


@pytest.mark.asyncio
async def test_a_null_rate_clears_it(
    test_client: AsyncClient, admin_auth_headers: dict[str, str]
) -> None:
    """Clearing a rate is how an admin stops reporting a cost they distrust."""
    await test_client.patch(
        "/api/v1/admin/llm-config",
        headers=admin_auth_headers,
        json={"input_price_per_mtok": "3.00"},
    )

    response = await test_client.patch(
        "/api/v1/admin/llm-config",
        headers=admin_auth_headers,
        json={"input_price_per_mtok": None},
    )

    assert response.status_code == 200
    assert response.json()["input_price_per_mtok"] is None


@pytest.mark.asyncio
async def test_a_negative_rate_is_rejected(
    test_client: AsyncClient, admin_auth_headers: dict[str, str]
) -> None:
    response = await test_client.patch(
        "/api/v1/admin/llm-config",
        headers=admin_auth_headers,
        json={"input_price_per_mtok": "-1.00"},
    )

    assert response.status_code == 422


@pytest.mark.asyncio
async def test_an_absurd_rate_is_rejected_as_a_typo(
    test_client: AsyncClient, admin_auth_headers: dict[str, str]
) -> None:
    """A misplaced decimal would otherwise report a five-figure bill."""
    response = await test_client.patch(
        "/api/v1/admin/llm-config",
        headers=admin_auth_headers,
        json={"input_price_per_mtok": "300000.00"},
    )

    assert response.status_code == 422


@pytest.mark.asyncio
async def test_summary_flags_a_period_spanning_two_models(
    test_client: AsyncClient,
    db_session: AsyncSession,
    admin_auth_headers: dict[str, str],
    other_user: User,
) -> None:
    """One instance-wide rate pair cannot price two models, so the total has
    to be labelled rather than presented as a figure."""
    await _spend(
        db_session, other_user, input_tokens=1_000, output_tokens=0,
        model="claude-sonnet-5",
    )
    await _spend(
        db_session, other_user, input_tokens=1_000, output_tokens=0,
        model="claude-haiku-4-5-20251001",
    )

    response = await test_client.get(
        "/api/v1/admin/token-usage/summary", headers=admin_auth_headers
    )

    body = response.json()
    assert body["mixed_models"] is True
    assert set(body["models"]) == {"claude-sonnet-5", "claude-haiku-4-5-20251001"}


@pytest.mark.asyncio
async def test_summary_does_not_flag_a_single_model(
    test_client: AsyncClient,
    db_session: AsyncSession,
    admin_auth_headers: dict[str, str],
    other_user: User,
) -> None:
    await _spend(db_session, other_user, input_tokens=1_000, output_tokens=0)

    response = await test_client.get(
        "/api/v1/admin/token-usage/summary", headers=admin_auth_headers
    )

    assert response.json()["mixed_models"] is False
