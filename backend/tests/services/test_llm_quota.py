"""The monthly token quota: how a limit is resolved, and how usage accrues."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from decimal import Decimal

from app.models.llm_config import DEFAULT_MONTHLY_TOKEN_LIMIT, LlmConfig
from app.models.llm_token_usage import LlmTokenUsage, current_period
from app.models.user import User
from app.services.llm.base import TokenUsage
from app.services.llm.quota import (
    QuotaExceeded,
    UsageSummary,
    get_llm_config,
    quota_for,
    record_usage,
    require_quota,
    usage_summary,
)


@pytest_asyncio.fixture
async def instructor(db_session: AsyncSession) -> User:
    user = User(
        id=uuid.uuid4(),
        email=f"quota-{uuid.uuid4().hex[:8]}@example.com",
        display_name="Quota Instructor",
        role="instructor",
    )
    db_session.add(user)
    await db_session.flush()
    return user


async def _spend(db: AsyncSession, user: User, total: int, period: str | None = None) -> None:
    db.add(
        LlmTokenUsage(
            user_id=user.id,
            period=period or current_period(),
            feature="summary",
            model_used="test-model",
            input_tokens=total,
            output_tokens=0,
            total_tokens=total,
        )
    )
    await db.flush()


# ── current_period ───────────────────────────────────────────────────────────


def test_period_is_a_utc_calendar_month() -> None:
    assert current_period(datetime(2026, 9, 15, 12, 0, tzinfo=timezone.utc)) == "2026-09"
    assert current_period(datetime(2026, 1, 1, 0, 0, tzinfo=timezone.utc)) == "2026-01"


def test_period_zero_pads_the_month() -> None:
    """String comparison and ordering both depend on a fixed width."""
    assert current_period(datetime(2026, 3, 9, tzinfo=timezone.utc)) == "2026-03"


# ── get_llm_config ───────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_config_is_created_on_first_read(db_session: AsyncSession) -> None:
    """A fresh instance has no row; reading must not 500."""
    config = await get_llm_config(db_session)

    assert config.llm_provider == "anthropic"
    assert config.llm_model
    assert config.default_monthly_token_limit == DEFAULT_MONTHLY_TOKEN_LIMIT


@pytest.mark.asyncio
async def test_config_read_twice_returns_the_same_row(db_session: AsyncSession) -> None:
    """Two reads must not leave two rows behind — the row is the instance."""
    first = await get_llm_config(db_session)
    second = await get_llm_config(db_session)

    assert first.id == second.id
    rows = (await db_session.execute(select(LlmConfig))).scalars().all()
    assert len(rows) == 1


# ── quota_for ────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_user_with_no_override_follows_the_instance_default(
    db_session: AsyncSession, instructor: User
) -> None:
    config = await get_llm_config(db_session)
    config.default_monthly_token_limit = 1_000
    await db_session.flush()

    quota = await quota_for(db_session, instructor)

    assert quota.limit == 1_000
    assert quota.used == 0
    assert quota.remaining == 1_000
    assert quota.exceeded is False


@pytest.mark.asyncio
async def test_per_user_override_beats_the_default(
    db_session: AsyncSession, instructor: User
) -> None:
    config = await get_llm_config(db_session)
    config.default_monthly_token_limit = 1_000
    instructor.monthly_token_limit = 50
    await db_session.flush()

    quota = await quota_for(db_session, instructor)

    assert quota.limit == 50


@pytest.mark.asyncio
async def test_override_of_zero_blocks_rather_than_falling_back(
    db_session: AsyncSession, instructor: User
) -> None:
    """0 is a real limit, not a missing one. `or` would read it as unset."""
    instructor.monthly_token_limit = 0
    await db_session.flush()

    quota = await quota_for(db_session, instructor)

    assert quota.limit == 0
    assert quota.exceeded is True


@pytest.mark.asyncio
async def test_admins_are_never_metered(
    db_session: AsyncSession, instructor: User
) -> None:
    """An admin holds the shared key; rationing them locks up the instance."""
    instructor.role = "admin"
    instructor.monthly_token_limit = 0
    await _spend(db_session, instructor, 10_000_000)

    quota = await quota_for(db_session, instructor)

    assert quota.limit is None
    assert quota.unlimited is True
    assert quota.exceeded is False
    assert quota.remaining is None


@pytest.mark.asyncio
async def test_used_sums_only_the_current_period(
    db_session: AsyncSession, instructor: User
) -> None:
    """The point of a monthly quota is that last month's spend is forgiven."""
    await _spend(db_session, instructor, 400, period="1999-01")
    await _spend(db_session, instructor, 30)
    await _spend(db_session, instructor, 12)

    quota = await quota_for(db_session, instructor)

    assert quota.used == 42


@pytest.mark.asyncio
async def test_used_ignores_other_users(
    db_session: AsyncSession, instructor: User, test_user: User
) -> None:
    await _spend(db_session, test_user, 999)

    quota = await quota_for(db_session, instructor)

    assert quota.used == 0


@pytest.mark.asyncio
async def test_exceeded_at_exactly_the_limit(
    db_session: AsyncSession, instructor: User
) -> None:
    """Spending the last token spends the allowance; 100/100 is not 'remaining 0 but fine'."""
    instructor.monthly_token_limit = 100
    await _spend(db_session, instructor, 100)

    quota = await quota_for(db_session, instructor)

    assert quota.remaining == 0
    assert quota.exceeded is True


@pytest.mark.asyncio
async def test_remaining_never_goes_negative(
    db_session: AsyncSession, instructor: User
) -> None:
    """A single call can overshoot; the number a user is shown should not lie."""
    instructor.monthly_token_limit = 100
    await _spend(db_session, instructor, 250)

    quota = await quota_for(db_session, instructor)

    assert quota.used == 250
    assert quota.remaining == 0


# ── require_quota ────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_require_quota_passes_under_the_limit(
    db_session: AsyncSession, instructor: User
) -> None:
    instructor.monthly_token_limit = 100
    await _spend(db_session, instructor, 99)

    quota = await require_quota(db_session, instructor)

    assert quota.remaining == 1


@pytest.mark.asyncio
async def test_require_quota_raises_once_spent(
    db_session: AsyncSession, instructor: User
) -> None:
    instructor.monthly_token_limit = 100
    await _spend(db_session, instructor, 100)

    with pytest.raises(QuotaExceeded) as exc_info:
        await require_quota(db_session, instructor)

    assert exc_info.value.quota.used == 100


# ── record_usage ─────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_record_usage_writes_the_reported_counts(
    db_session: AsyncSession, instructor: User
) -> None:
    await record_usage(
        db_session,
        user_id=instructor.id,
        feature="summary",
        model_used="claude-test",
        usage=TokenUsage(input_tokens=120, output_tokens=30),
    )

    row = (await db_session.execute(select(LlmTokenUsage))).scalar_one()
    assert row.user_id == instructor.id
    assert row.input_tokens == 120
    assert row.output_tokens == 30
    assert row.total_tokens == 150
    assert row.feature == "summary"
    assert row.model_used == "claude-test"
    assert row.period == current_period()


@pytest.mark.asyncio
async def test_record_usage_skips_a_zero_call(
    db_session: AsyncSession, instructor: User
) -> None:
    """A fully-cached request makes no call. A 0-token row would imply it did."""
    await record_usage(
        db_session,
        user_id=instructor.id,
        feature="commit_quality",
        model_used="claude-test",
        usage=TokenUsage(),
    )

    rows = (await db_session.execute(select(LlmTokenUsage))).scalars().all()
    assert rows == []


@pytest.mark.asyncio
async def test_recorded_usage_counts_against_the_quota(
    db_session: AsyncSession, instructor: User
) -> None:
    """The two halves have to meet: what is recorded is what is charged."""
    instructor.monthly_token_limit = 200
    await record_usage(
        db_session,
        user_id=instructor.id,
        feature="summary",
        model_used="claude-test",
        usage=TokenUsage(input_tokens=150, output_tokens=50),
    )

    quota = await quota_for(db_session, instructor)

    assert quota.used == 200
    assert quota.exceeded is True


# ── UsageSummary costing ─────────────────────────────────────────────────────
#
# Pure arithmetic, so these need no database. The tokens are measured; only
# the rates are entered by hand, which is the whole reason cost is reported as
# an estimate rather than a fact.


def _summary(**overrides) -> UsageSummary:
    defaults = dict(
        period="2026-09",
        input_tokens=0,
        output_tokens=0,
        calls=0,
        models=["claude-sonnet-5"],
        input_price_per_mtok=Decimal("3.00"),
        output_price_per_mtok=Decimal("15.00"),
    )
    return UsageSummary(**{**defaults, **overrides})


def test_cost_is_priced_per_million_tokens() -> None:
    summary = _summary(input_tokens=1_000_000, output_tokens=1_000_000)

    assert summary.estimated_cost_usd == Decimal("18.0000")


def test_input_and_output_are_priced_at_their_own_rates() -> None:
    """Output tokens cost several times what input tokens do; one blended
    rate over the total would understate a summary-heavy month."""
    summary = _summary(input_tokens=2_000_000, output_tokens=100_000)

    # 2 x 3.00 + 0.1 x 15.00
    assert summary.estimated_cost_usd == Decimal("7.5000")


def test_cost_is_unavailable_rather_than_zero_when_rates_are_unset() -> None:
    """An instance with no rates has an unknown cost. $0.00 would call it free.

    Each rate is checked on its own: half-configured is still unpriceable, and
    treating a missing output rate as zero would report a summary-heavy month
    as costing only its input tokens.
    """
    neither = _summary(
        input_tokens=9_000_000,
        input_price_per_mtok=None,
        output_price_per_mtok=None,
    )
    assert neither.estimated_cost_usd is None
    assert (
        _summary(input_tokens=9_000_000, output_price_per_mtok=None).estimated_cost_usd
        is None
    )
    assert (
        _summary(input_tokens=9_000_000, input_price_per_mtok=None).estimated_cost_usd
        is None
    )


def test_zero_usage_at_known_rates_really_is_zero() -> None:
    """Distinct from unset rates: nothing spent at a known price costs nothing."""
    assert _summary().estimated_cost_usd == Decimal("0.0000")


def test_a_light_month_does_not_round_away_to_nothing() -> None:
    """2dp would render a real charge as $0.00 and imply the month was free."""
    summary = _summary(input_tokens=1_000, output_tokens=200)

    # 0.001 x 3.00 + 0.0002 x 15.00 = 0.003 + 0.003
    assert summary.estimated_cost_usd == Decimal("0.0060")


def test_total_tokens_is_the_sum_of_both_directions() -> None:
    assert _summary(input_tokens=120, output_tokens=30).total_tokens == 150


def test_fractional_cent_rates_are_held_exactly() -> None:
    """Numeric, not float: 0.80 has no exact binary representation, and a
    cost figure that drifts in the last place looks like a bug in the bill."""
    summary = _summary(
        input_tokens=1_000_000,
        output_tokens=1_000_000,
        input_price_per_mtok=Decimal("0.80"),
        output_price_per_mtok=Decimal("4.00"),
    )

    assert summary.estimated_cost_usd == Decimal("4.8000")
