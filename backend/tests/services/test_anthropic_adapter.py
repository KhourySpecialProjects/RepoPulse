"""Tests for AnthropicAdapter's response unwrapping and token accounting.

Newer Claude models can return a ThinkingBlock ahead of the text, so the
response content is a list whose first element is not necessarily what the
caller wants. Reading content[0].text raises AttributeError on those models —
which surfaced as every LLM call in the app failing at once.

The token counts matter for a second reason: they are what the per-user
monthly quota charges against, so they have to come from what the API
reported and accumulate across every call the adapter makes.
"""
from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.services.llm.anthropic_adapter import AnthropicAdapter


def _block(kind: str, **attrs: object) -> SimpleNamespace:
    return SimpleNamespace(type=kind, **attrs)


def _adapter_returning(
    *blocks: SimpleNamespace, usage: SimpleNamespace | None = None
) -> AnthropicAdapter:
    adapter = AnthropicAdapter(model="claude-sonnet-5", api_key="test-key")
    response = SimpleNamespace(content=list(blocks))
    if usage is not None:
        response.usage = usage
    adapter._client = SimpleNamespace(
        messages=SimpleNamespace(create=AsyncMock(return_value=response))
    )
    return adapter


async def test_plain_text_response() -> None:
    adapter = _adapter_returning(_block("text", text="hello"))
    assert await adapter.generate("prompt") == "hello"


async def test_thinking_block_is_skipped() -> None:
    """The regression: a ThinkingBlock has no .text, and it comes first."""
    adapter = _adapter_returning(
        _block("thinking", thinking="deliberating..."),
        _block("text", text='[{"i":0,"s":"good","t":"substantive"}]'),
    )
    assert await adapter.generate("prompt") == '[{"i":0,"s":"good","t":"substantive"}]'


async def test_multiple_text_blocks_are_joined() -> None:
    adapter = _adapter_returning(
        _block("thinking", thinking="..."),
        _block("text", text='[{"i":0,'),
        _block("text", text='"s":"ok","t":"logistical"}]'),
    )
    assert await adapter.generate("prompt") == '[{"i":0,"s":"ok","t":"logistical"}]'


async def test_no_text_block_returns_empty_string() -> None:
    """Callers treat an unreadable answer as a failure, which is the right
    outcome here — better an empty string they reject than an exception that
    takes down a whole batch."""
    adapter = _adapter_returning(_block("thinking", thinking="..."))
    assert await adapter.generate("prompt") == ""


@pytest.mark.parametrize("system", [None, "be terse"])
async def test_system_prompt_is_passed_through_only_when_given(system: str | None) -> None:
    adapter = _adapter_returning(_block("text", text="ok"))
    await adapter.generate("prompt", system=system, max_tokens=64)

    kwargs = adapter._client.messages.create.call_args.kwargs
    assert kwargs["max_tokens"] == 64
    assert kwargs["model"] == "claude-sonnet-5"
    assert ("system" in kwargs) is (system is not None)


# ── token accounting ─────────────────────────────────────────────────────────


async def test_usage_starts_at_zero() -> None:
    adapter = _adapter_returning(_block("text", text="ok"))
    assert adapter.usage.total_tokens == 0


async def test_usage_records_what_the_api_reported() -> None:
    adapter = _adapter_returning(
        _block("text", text="ok"),
        usage=SimpleNamespace(input_tokens=1_200, output_tokens=340),
    )

    await adapter.generate("prompt")

    assert adapter.usage.input_tokens == 1_200
    assert adapter.usage.output_tokens == 340
    assert adapter.usage.total_tokens == 1_540


async def test_usage_accumulates_across_calls() -> None:
    """The classifier reuses one adapter for every chunk of a batch, so the
    per-request total is the sum over its calls, not the last one."""
    adapter = _adapter_returning(
        _block("text", text="ok"),
        usage=SimpleNamespace(input_tokens=10, output_tokens=5),
    )

    await adapter.generate("one")
    await adapter.generate("two")
    await adapter.generate("three")

    assert adapter.usage.total_tokens == 45


async def test_a_response_without_usage_counts_as_zero() -> None:
    """Never a guess. An unreported call is charged nothing rather than an
    invented average — the quota has to be defensible to the user it blocks."""
    adapter = _adapter_returning(_block("text", text="ok"))

    await adapter.generate("prompt")

    assert adapter.usage.total_tokens == 0


async def test_usage_is_recorded_even_when_no_text_comes_back() -> None:
    """A thinking-only answer is useless to the caller and still billed."""
    adapter = _adapter_returning(
        _block("thinking", thinking="..."),
        usage=SimpleNamespace(input_tokens=80, output_tokens=200),
    )

    assert await adapter.generate("prompt") == ""
    assert adapter.usage.total_tokens == 280


# ── call accounting ──────────────────────────────────────────────────────────
#
# Counted separately from tokens because the admin call-volume graph plots
# these, and the two genuinely diverge: a response that reports no usage is
# charged zero tokens and is still one request the provider served.


async def test_calls_start_at_zero() -> None:
    adapter = _adapter_returning(_block("text", text="ok"))
    assert adapter.usage.calls == 0


async def test_each_generate_counts_one_call() -> None:
    """One `generate` is one request, which is the unit the graph plots.

    The classifier sends up to BATCH_SIZE commits per call, so this counter is
    what makes "one Classify click = N batches" reportable at all.
    """
    adapter = _adapter_returning(
        _block("text", text="ok"),
        usage=SimpleNamespace(input_tokens=10, output_tokens=5),
    )

    await adapter.generate("one")
    await adapter.generate("two")
    await adapter.generate("three")

    assert adapter.usage.calls == 3


async def test_a_response_without_usage_still_counts_as_a_call() -> None:
    """Where tokens and calls part company.

    An unreported response is charged zero tokens — never a guess — but it was
    still a request, and a call graph that dropped it would under-report load.
    """
    adapter = _adapter_returning(_block("text", text="ok"))

    await adapter.generate("prompt")

    assert adapter.usage.total_tokens == 0
    assert adapter.usage.calls == 1
