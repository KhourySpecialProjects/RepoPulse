from __future__ import annotations

import httpx
from opentelemetry import trace

from app.services.llm.base import LLMService

_tracer = trace.get_tracer("app.llm.ollama")


class OllamaAdapter(LLMService):
    """LLM adapter for locally-running Ollama models."""

    def __init__(
        self,
        model: str = "llama3.2",
        base_url: str = "http://localhost:11434",
    ) -> None:
        self._model = model
        self._base_url = base_url.rstrip("/")

    async def generate(
        self,
        prompt: str,
        system: str | None = None,
        max_tokens: int = 1024,
    ) -> str:
        with _tracer.start_as_current_span("ollama.generate") as span:
            span.set_attribute("llm.model_name", self._model)
            span.set_attribute("input.value", prompt[:2000])
            if system is not None:
                span.set_attribute("llm.system", system)

            messages = []
            if system:
                messages.append({"role": "system", "content": system})
            messages.append({"role": "user", "content": prompt})

            payload = {
                "model": self._model,
                "messages": messages,
                "stream": False,
                "options": {"num_predict": max_tokens},
            }

            async with httpx.AsyncClient(timeout=120.0) as client:
                response = await client.post(
                    f"{self._base_url}/api/chat",
                    json=payload,
                )
                response.raise_for_status()
                data = response.json()
                result = data["message"]["content"]

            span.set_attribute("output.value", result[:2000])
            return result
