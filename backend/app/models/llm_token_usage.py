"""One row per LLM call, carrying the tokens it actually cost.

Written after the call returns, from the token counts the provider reported —
never from an estimate. That distinction is the whole point: `LlmUsage` in
app/schemas/admin.py documents at length why a spend figure derived from
`rows x assumed-tokens` would be worse than no figure at all. These rows are
measured, so the quota built on them is too.

A failed call writes nothing, so this table contains only successes. Usage a
user was never billed for is usage they should not be charged against.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.database import Base

#: Which RepoPulse feature spent the tokens. Free-text rather than an enum so
#: adding a fifth LLM feature does not need a migration to record its usage.
FEATURE_SUMMARY = "summary"
FEATURE_COMMIT_QUALITY = "commit_quality"
FEATURE_COMMIT_CLASSIFICATION = "commit_classification"


def current_period(now: datetime | None = None) -> str:
    """The calendar-month key a call made *now* counts against, e.g. "2026-09".

    UTC, not server-local: the reset instant has to be the same for every user
    regardless of where the container runs, and a month boundary that moves
    with the host timezone would silently re-open a spent quota.
    """
    moment = now or datetime.now(timezone.utc)
    return f"{moment.year:04d}-{moment.month:02d}"


class LlmTokenUsage(Base):
    __tablename__ = "llm_token_usage"
    __table_args__ = (
        # The quota check sums over exactly this pair on every LLM request.
        Index("ix_llm_token_usage_user_period", "user_id", "period"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    #: Denormalised from created_at so the quota sum is an index lookup rather
    #: than a date_trunc over the table. Written by `current_period`.
    period: Mapped[str] = mapped_column(String(7), nullable=False)
    feature: Mapped[str] = mapped_column(String(50), nullable=False)
    model_used: Mapped[str] = mapped_column(String(200), nullable=False)
    input_tokens: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="0"
    )
    output_tokens: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="0"
    )
    #: Stored rather than computed: this is the column the quota sums, and a
    #: generated column would not survive the Alembic model-diff test.
    total_tokens: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="0"
    )
    created_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
