from __future__ import annotations

import anthropic

from app.core.config import settings
from app.services.llm.base import LLMService


class AnthropicAdapter(LLMService):
    def __init__(
        self,
        model: str = "claude-sonnet-4-20250514",
        api_key: str | None = None,
    ) -> None:
        self._model = model
        resolved_key = api_key or settings.ANTHROPIC_API_KEY
        self._client = anthropic.AsyncAnthropic(api_key=resolved_key)

    async def generate(
        self,
        prompt: str,
        system: str | None = None,
        max_tokens: int = 1024,
    ) -> str:
        kwargs: dict = {
            "model": self._model,
            "max_tokens": max_tokens,
            "messages": [{"role": "user", "content": prompt}],
        }
        if system is not None:
            kwargs["system"] = system

        message = await self._client.messages.create(**kwargs)
        return message.content[0].text
