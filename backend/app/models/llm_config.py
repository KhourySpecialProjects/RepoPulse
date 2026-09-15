"""The instance's single LLM configuration.

One row, instance-wide. Replaces the per-user provider/model/api-key columns
that used to live on AppSettings: every user now talks to the same model
through the same key, and only an administrator can change which.

The singleton is enforced in the database, not by convention. A second row
here would mean two different users getting two different models with no way
to tell which one wrote a cached score — so `singleton` is a unique column
whose only legal value is True, and `get_llm_config` is the only writer.
"""
from __future__ import annotations

import uuid

from decimal import Decimal

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    Integer,
    Numeric,
    String,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.config import settings
from app.db.database import Base

#: Tokens a non-admin user may spend per calendar month before LLM features
#: refuse. Deliberately generous: the limit exists to catch a runaway loop, not
#: to ration normal grading. Admins override it per instance and per user.
DEFAULT_MONTHLY_TOKEN_LIMIT = 500_000


class LlmConfig(Base):
    __tablename__ = "llm_config"
    __table_args__ = (
        CheckConstraint("singleton IS TRUE", name="ck_llm_config_singleton"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    # Unique + CHECK True: the pair makes a second row impossible to insert.
    singleton: Mapped[bool] = mapped_column(
        Boolean, nullable=False, unique=True, default=True, server_default="true"
    )
    llm_provider: Mapped[str] = mapped_column(
        String(100), nullable=False, default=settings.DEFAULT_LLM_PROVIDER
    )
    llm_model: Mapped[str] = mapped_column(
        String(200), nullable=False, default=settings.DEFAULT_LLM_MODEL
    )
    # NULL means "fall back to the ANTHROPIC_API_KEY env var", which is how a
    # Docker-Compose install works without anyone opening the admin panel.
    anthropic_api_key: Mapped[str | None] = mapped_column(
        String(500), nullable=True, default=None
    )
    ollama_base_url: Mapped[str | None] = mapped_column(
        String(500), nullable=True, default=None
    )
    # The instance-wide default. A user row may override it, including with 0
    # (blocked) — see User.monthly_token_limit.
    default_monthly_token_limit: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=DEFAULT_MONTHLY_TOKEN_LIMIT,
        server_default=str(DEFAULT_MONTHLY_TOKEN_LIMIT),
    )
    # Price in USD per million tokens, set by an administrator.
    #
    # NULL rather than 0, and nullable rather than seeded with today's list
    # price: a rate nobody entered would render as "$0.00" — a measured-looking
    # figure that is simply wrong — and a built-in table would go stale the
    # next time Anthropic changes prices, with nothing on screen to say so.
    # NULL means "no rates set", which the UI reports as cost unavailable.
    #
    # Numeric, not Float: these multiply into a dollar figure, and binary
    # floating point cannot hold 3.00 or 0.80 exactly.
    input_price_per_mtok: Mapped[Decimal | None] = mapped_column(
        Numeric(12, 4), nullable=True, default=None
    )
    output_price_per_mtok: Mapped[Decimal | None] = mapped_column(
        Numeric(12, 4), nullable=True, default=None
    )
    updated_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
