from __future__ import annotations

from abc import ABC, abstractmethod


class LLMService(ABC):
    @abstractmethod
    async def generate(
        self,
        prompt: str,
        system: str | None = None,
        max_tokens: int = 1024,
    ) -> str:
        ...
