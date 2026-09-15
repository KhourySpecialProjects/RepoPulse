"""The instance LLM config, and the per-user monthly token quota built on it.

Two things live here because they answer one question — "may this user make
this LLM call, and against whose key?" — and both are needed at every LLM
entry point.

How a limit is resolved, in order:

  1. Administrators are never metered. They hold the shared key; rationing
     them is how an instance ends up unable to raise its own limits.
  2. `users.monthly_token_limit`, when set. 0 is a real value meaning "no LLM
     access", so the test is `is not None`, never a truthiness check.
  3. `llm_config.default_monthly_token_limit`, the instance default.

Enforcement is pre-flight: a user under their limit may start a call that
overshoots it, because the cost of a call is unknowable until it returns.
A 500,001st token is not the risk this guards against — an unattended loop
spending millions is, and that stops at the next request.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.llm_config import LlmConfig
from app.models.llm_token_usage import LlmTokenUsage, current_period
from app.models.user import User
from app.services.llm.base import TokenUsage


@dataclass(frozen=True)
class Quota:
    """One user's standing for the current calendar month."""

    period: str
    used: int
    #: None means unlimited (an administrator).
    limit: int | None

    @property
    def unlimited(self) -> bool:
        return self.limit is None

    @property
    def remaining(self) -> int | None:
        """Tokens left, floored at 0. None when unlimited.

        Floored because a single call can overshoot the limit, and showing a
        user "-40,000 remaining" describes the accounting rather than their
        situation. `used` keeps the true number.
        """
        if self.limit is None:
            return None
        return max(self.limit - self.used, 0)

    @property
    def exceeded(self) -> bool:
        if self.limit is None:
            return False
        return self.used >= self.limit


class QuotaExceeded(Exception):
    """Raised by `require_quota`. Routes translate this into a 429.

    Carries the Quota so the response can tell the user how much they spent
    and when it resets — a bare "limit reached" leaves them with no next step.
    """

    def __init__(self, quota: Quota) -> None:
        self.quota = quota
        super().__init__(
            f"Monthly token limit reached: {quota.used}/{quota.limit} "
            f"for {quota.period}"
        )


async def get_llm_config(db: AsyncSession) -> LlmConfig:
    """The instance's single LLM config row, created on first read.

    Created lazily rather than seeded by migration 0010, so a database
    restored from an older dump needs no repair step and the live model id
    stays out of a migration that has to keep describing 2026 forever.

    The insert is an upsert on `singleton` rather than a read-then-add. Two
    concurrent first requests would otherwise race, and resolving that with a
    caught IntegrityError means catching one raised by *any* pending write in
    the caller's session — every LLM route calls this with work already in
    flight. `ON CONFLICT DO NOTHING` makes the race a no-op instead.
    """
    await db.execute(
        pg_insert(LlmConfig)
        .values(
            id=uuid.uuid4(),
            singleton=True,
            llm_provider=settings.DEFAULT_LLM_PROVIDER,
            llm_model=settings.DEFAULT_LLM_MODEL,
        )
        .on_conflict_do_nothing(index_elements=["singleton"])
    )

    # Re-read rather than returning the inserted values: on the common path
    # the row already existed and carries the administrator's edits, not the
    # environment defaults just offered above.
    result = await db.execute(select(LlmConfig).limit(1))
    return result.scalar_one()


@dataclass(frozen=True)
class UsageSummary:
    """Instance-wide token spend for one month, priced if rates are set."""

    period: str
    input_tokens: int
    output_tokens: int
    calls: int
    #: Models that actually spent tokens this period, in descending spend.
    #: More than one means a single instance-wide rate pair cannot price the
    #: total correctly — the UI has to say so rather than quietly averaging.
    models: list[str]
    input_price_per_mtok: Decimal | None
    output_price_per_mtok: Decimal | None

    @property
    def total_tokens(self) -> int:
        return self.input_tokens + self.output_tokens

    @property
    def estimated_cost_usd(self) -> Decimal | None:
        """Cost at the configured rates, or None if either rate is unset.

        None rather than 0: an instance with no rates entered has an unknown
        cost, and "$0.00" would report that as free.
        """
        if self.input_price_per_mtok is None or self.output_price_per_mtok is None:
            return None
        per_mtok = Decimal(1_000_000)
        cost = (
            Decimal(self.input_tokens) / per_mtok * self.input_price_per_mtok
            + Decimal(self.output_tokens) / per_mtok * self.output_price_per_mtok
        )
        # Four places, not two: a light month costs fractions of a cent, and
        # rounding to 2dp would render real spend as $0.00. The UI decides how
        # to display it.
        return cost.quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)


async def usage_summary(
    db: AsyncSession, period: str | None = None
) -> UsageSummary:
    """Total tokens spent across the instance in `period`, with rates attached."""
    window = period or current_period()

    totals = (
        await db.execute(
            select(
                func.coalesce(func.sum(LlmTokenUsage.input_tokens), 0),
                func.coalesce(func.sum(LlmTokenUsage.output_tokens), 0),
                func.count(LlmTokenUsage.id),
            ).where(LlmTokenUsage.period == window)
        )
    ).one()

    models = (
        await db.execute(
            select(LlmTokenUsage.model_used)
            .where(LlmTokenUsage.period == window)
            .group_by(LlmTokenUsage.model_used)
            .order_by(func.sum(LlmTokenUsage.total_tokens).desc())
        )
    ).scalars().all()

    config = await get_llm_config(db)

    return UsageSummary(
        period=window,
        input_tokens=int(totals[0]),
        output_tokens=int(totals[1]),
        calls=int(totals[2]),
        models=list(models),
        input_price_per_mtok=config.input_price_per_mtok,
        output_price_per_mtok=config.output_price_per_mtok,
    )


async def tokens_used(
    db: AsyncSession, user_id: uuid.UUID, period: str | None = None
) -> int:
    """Tokens this user spent in `period`, defaulting to the current month."""
    result = await db.execute(
        select(func.coalesce(func.sum(LlmTokenUsage.total_tokens), 0)).where(
            LlmTokenUsage.user_id == user_id,
            LlmTokenUsage.period == (period or current_period()),
        )
    )
    return int(result.scalar_one())


async def quota_for(db: AsyncSession, user: User) -> Quota:
    """Resolve `user`'s limit and what they have spent against it."""
    period = current_period()

    if user.role == "admin":
        return Quota(
            period=period,
            used=await tokens_used(db, user.id, period),
            limit=None,
        )

    if user.monthly_token_limit is not None:
        limit = user.monthly_token_limit
    else:
        config = await get_llm_config(db)
        limit = config.default_monthly_token_limit

    return Quota(
        period=period,
        used=await tokens_used(db, user.id, period),
        limit=limit,
    )


async def require_quota(db: AsyncSession, user: User) -> Quota:
    """Quota for `user`, raising QuotaExceeded if it is spent."""
    quota = await quota_for(db, user)
    if quota.exceeded:
        raise QuotaExceeded(quota)
    return quota


async def record_usage(
    db: AsyncSession,
    user_id: uuid.UUID,
    feature: str,
    model_used: str,
    usage: TokenUsage,
) -> None:
    """Charge `usage` to `user_id`. A zero-token call writes nothing.

    Zero means no call was made — every commit served from cache, or a test
    double standing in for the adapter. A 0-token row would claim otherwise in
    the admin usage view, and rows-per-call is exactly what that view counts.

    Does not commit. The caller owns the transaction: usage belongs in the
    same commit as the work it paid for, so a failed request charges nothing.
    """
    if usage.total_tokens <= 0:
        return

    db.add(
        LlmTokenUsage(
            user_id=user_id,
            period=current_period(),
            feature=feature,
            model_used=model_used,
            input_tokens=usage.input_tokens,
            output_tokens=usage.output_tokens,
            total_tokens=usage.total_tokens,
        )
    )
    await db.flush()
