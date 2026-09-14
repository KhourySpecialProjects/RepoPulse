"""Tests for AnthropicAdapter's response unwrapping.

Newer Claude models can return a ThinkingBlock ahead of the text, so the
response content is a list whose first element is not necessarily what the
caller wants. Reading content[0].text raises AttributeError on those models —
which surfaced as every LLM call in the app failing at once.
"""
from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.services.llm.anthropic_adapter import AnthropicAdapter


def _block(kind: str, **attrs: object) -> SimpleNamespace:
    return SimpleNamespace(type=kind, **attrs)


def _adapter_returning(*blocks: SimpleNamespace) -> AnthropicAdapter:
    adapter = AnthropicAdapter(model="claude-sonnet-5", api_key="test-key")
    adapter._client = SimpleNamespace(
        messages=SimpleNamespace(
            create=AsyncMock(return_value=SimpleNamespace(content=list(blocks)))
        )
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
