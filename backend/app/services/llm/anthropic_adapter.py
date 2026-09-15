from __future__ import annotations

import anthropic

from app.core.config import settings
from app.services.llm.base import LLMService


class AnthropicAdapter(LLMService):
    def __init__(
        self,
        model: str = settings.DEFAULT_LLM_MODEL,
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

        # Recorded before the content is unwrapped: a thinking-only answer
        # returns "" to the caller and is billed all the same, and the quota
        # has to charge for what the API charged for. getattr because a
        # response object is not contractually required to carry usage —
        # an unreported call is charged zero rather than an invented average.
        reported = getattr(message, "usage", None)
        if reported is not None:
            self.usage.add(
                int(getattr(reported, "input_tokens", 0) or 0),
                int(getattr(reported, "output_tokens", 0) or 0),
            )

        # Not content[0].text: newer models can return a ThinkingBlock first,
        # which has no .text at all. Collect the text blocks and leave the rest
        # alone. An answer with no text block yields "", which every caller
        # already treats as an unusable response.
        return "".join(
            block.text for block in message.content
            if getattr(block, "type", None) == "text"
        )
