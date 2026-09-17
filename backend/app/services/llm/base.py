from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass
class TokenUsage:
    """What an LLM cost: tokens it reported, and requests it took. Measured.

    Mutable and accumulating: one LLMService instance serves one request, and
    the classifier issues several concurrent `generate` calls through it, so
    the per-request cost is the running sum rather than the last answer.

    `calls` is tracked separately from tokens rather than derived from them,
    because the two legitimately disagree. A response that carries no usage
    block is charged zero tokens — never a guess — and was still a request the
    provider served. Deriving call count from token totals would lose it, and
    call count is what the admin volume graph plots.
    """

    input_tokens: int = 0
    output_tokens: int = 0
    #: Provider requests behind these totals. One `generate` is one call, so
    #: for the classifier this is the number of batches it sent.
    calls: int = 0

    @property
    def total_tokens(self) -> int:
        return self.input_tokens + self.output_tokens

    def add(self, input_tokens: int, output_tokens: int) -> None:
        """Add tokens without counting a call.

        Kept for callers that are reconciling totals rather than reporting a
        request. An adapter completing a call wants `record_call`.
        """
        self.input_tokens += input_tokens
        self.output_tokens += output_tokens

    def record_call(self, input_tokens: int = 0, output_tokens: int = 0) -> None:
        """Book one completed provider request, with whatever it reported.

        Called once per `generate` that returns, including one that reported
        no usage: zero tokens is an honest charge, zero calls would not be.
        """
        self.calls += 1
        self.add(input_tokens, output_tokens)


class LLMService(ABC):
    @property
    def usage(self) -> TokenUsage:
        """This instance's running token total.

        Lazily created rather than set in `__init__` so that any subclass works
        without calling super() — including the test doubles in
        tests/conftest.py, which define `generate` and nothing else.
        """
        existing: TokenUsage | None = getattr(self, "_usage", None)
        if existing is None:
            existing = TokenUsage()
            self._usage = existing
        return existing

    @abstractmethod
    async def generate(
        self,
        prompt: str,
        system: str | None = None,
        max_tokens: int = 1024,
    ) -> str:
        ...


def usage_of(service: object) -> TokenUsage:
    """The tokens `service` consumed, or zero if it cannot say.

    Guards the quota against anything that is not a real adapter. The existing
    suite patches the LLM factory with `AsyncMock`, whose attribute access
    auto-creates a Mock — so a bare `service.usage.total_tokens` would hand the
    quota a Mock where it expects an int and write nonsense into the usage
    table. An object that does not report real counts is charged nothing.
    """
    usage = getattr(service, "usage", None)
    return usage if isinstance(usage, TokenUsage) else TokenUsage()
