from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass
class TokenUsage:
    """Tokens an LLM reported consuming. Measured, never estimated.

    Mutable and accumulating: one LLMService instance serves one request, and
    the classifier issues several concurrent `generate` calls through it, so
    the per-request cost is the running sum rather than the last answer.
    """

    input_tokens: int = 0
    output_tokens: int = 0

    @property
    def total_tokens(self) -> int:
        return self.input_tokens + self.output_tokens

    def add(self, input_tokens: int, output_tokens: int) -> None:
        self.input_tokens += input_tokens
        self.output_tokens += output_tokens


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
