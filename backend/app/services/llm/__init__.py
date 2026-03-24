from __future__ import annotations

from app.services.llm.anthropic_adapter import AnthropicAdapter
from app.services.llm.base import LLMService
from app.services.llm.ollama_adapter import OllamaAdapter


def get_llm_service(
    provider: str,
    model: str,
    anthropic_api_key: str | None = None,
    ollama_base_url: str | None = None,
) -> LLMService:
    """Factory: return the right LLMService based on provider."""
    if provider == "ollama":
        return OllamaAdapter(
            model=model or "llama3.2",
            base_url=ollama_base_url or "http://localhost:11434",
        )
    # Default: anthropic
    return AnthropicAdapter(model=model, api_key=anthropic_api_key)
