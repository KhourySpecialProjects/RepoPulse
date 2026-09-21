"""Request/response shapes for the shared LLM config and the token quota."""
from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Annotated, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

#: A non-negative token count. `Annotated[...]` inside the Optional rather
#: than `Optional[int] = Field(ge=0)`: the constraint has to attach to the int
#: branch, not to the nullable wrapper around it.
TokenCount = Annotated[int, Field(ge=0)]

#: USD per million tokens. Bounded above as a typo guard — $10,000/M is three
#: orders of magnitude past any real list price, so a misplaced decimal that
#: would otherwise report a five-figure bill is rejected at the edge instead.
TokenPrice = Annotated[Decimal, Field(ge=0, le=10_000, decimal_places=4)]


class TokenQuotaRead(BaseModel):
    """One user's standing for the current calendar month.

    `limit` and `remaining` are null together, and only for an unmetered
    administrator. A caller should branch on `unlimited` rather than on null,
    which is why the flag is sent explicitly instead of being inferred.
    """

    period: str
    used: int
    limit: Optional[int] = None
    remaining: Optional[int] = None
    unlimited: bool
    exceeded: bool


class TokenLimitExceeded(BaseModel):
    """The 429 body. Carries the numbers, not just the refusal.

    A bare "limit reached" leaves the user with no next step; these fields let
    the UI say how much was spent, against what, and when it resets.
    """

    detail: str
    error_code: Literal["token_limit_exceeded"] = "token_limit_exceeded"
    period: str
    used: int
    limit: int


class LlmConfigRead(BaseModel):
    """The instance LLM config, admin-only.

    The key is reported as a boolean, never the value, never a prefix, never a
    length — the same rule SystemStatus follows. A four-character prefix is
    still a key fragment once it reaches a log aggregator.
    """

    model_config = ConfigDict(from_attributes=True, protected_namespaces=())

    id: uuid.UUID
    llm_provider: str
    llm_model: str
    anthropic_api_key_configured: bool
    #: True when no key is stored but ANTHROPIC_API_KEY is set in the
    #: environment, which is a working instance that the panel would otherwise
    #: report as unconfigured.
    anthropic_api_key_from_env: bool
    ollama_base_url: Optional[str] = None
    default_monthly_token_limit: int
    #: USD per million tokens. Null means no rate set, which is reported as
    #: "cost unavailable" rather than as zero.
    input_price_per_mtok: Optional[Decimal] = None
    output_price_per_mtok: Optional[Decimal] = None
    updated_at: Optional[datetime] = None


class LlmConfigUpdate(BaseModel):
    """Admin edit of the instance config. Every field optional; unset is untouched.

    `anthropic_api_key` accepts a null to clear the stored key and fall back to
    the environment variable. It is never echoed back — see LlmConfigRead.
    """

    llm_provider: Optional[Literal["anthropic", "ollama"]] = None
    llm_model: Optional[Annotated[str, Field(max_length=200)]] = None
    anthropic_api_key: Optional[Annotated[str, Field(max_length=500)]] = None
    ollama_base_url: Optional[Annotated[str, Field(max_length=500)]] = None
    # 0 is meaningful: it revokes LLM access for every user with no override.
    # No upper bound — an instance on a local Ollama model has no cost to cap,
    # and an arbitrary ceiling would just be a second limit to discover.
    default_monthly_token_limit: Optional[TokenCount] = None
    # An explicit null clears a rate, which is how an admin says "stop
    # reporting a cost" — 0 would instead claim the tokens are free.
    input_price_per_mtok: Optional[TokenPrice] = None
    output_price_per_mtok: Optional[TokenPrice] = None


class UserTokenUsage(BaseModel):
    """A row of the admin token-usage table: who, how much, against what."""

    user_id: uuid.UUID
    display_name: str
    email: str
    role: str
    used: int
    limit: Optional[int] = None
    remaining: Optional[int] = None
    unlimited: bool
    exceeded: bool
    #: The user's own override, or null when they follow the instance default.
    #: Distinct from `limit`, which is the resolved effective number — the UI
    #: needs both to show "500,000 (default)" versus "500,000 (set)".
    override: Optional[int] = None


class UserTokenUsageListResponse(BaseModel):
    items: list[UserTokenUsage]
    total: int
    limit: int
    offset: int
    period: str


class TokenUsageSummary(BaseModel):
    """Instance-wide token spend for a month, and what it cost.

    Replaces the old LLM Usage tab's "Token usage and cost" card, which could
    only say the figure was unavailable: no token counts were persisted then.
    They are now, so everything here except the rates is measured.
    """

    period: str
    input_tokens: int
    output_tokens: int
    total_tokens: int
    #: Successful LLM calls in the period. Failures write no usage row, so
    #: this counts only calls that were actually billed.
    calls: int
    models: list[str]
    input_price_per_mtok: Optional[Decimal] = None
    output_price_per_mtok: Optional[Decimal] = None
    #: Null when either rate is unset — an unknown cost, not a free one.
    estimated_cost_usd: Optional[Decimal] = None
    #: True when more than one model spent tokens this period. One
    #: instance-wide rate pair cannot price two models, so the total is a
    #: lower or upper bound rather than a figure, and the UI must say so.
    mixed_models: bool


class UserTokenLimitUpdate(BaseModel):
    """Set or clear one user's override.

    An explicit null means "follow the instance default"; 0 means "no LLM
    access". Both are deliberate states, so the field is required — omitting
    it would make the two indistinguishable from a typo.
    """

    monthly_token_limit: Optional[TokenCount] = Field(...)
