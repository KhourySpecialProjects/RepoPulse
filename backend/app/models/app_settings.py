from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, JSON, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base


DEFAULT_COMMIT_EVALUATION_CRITERIA = """Evaluate commit messages for clarity and informativeness.

Score each commit as exactly one of: good, ok, or bad.
- good: clearly describes what changed and/or why.
- ok: somewhat descriptive but vague.
- bad: uninformative or a placeholder such as \"fix\", \"update\", \"wip\", or \"done\".

Use the commit information and diff as evidence, and use judgment rather than inventing requirements."""


class AppSettings(Base):
    __tablename__ = "app_settings"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, unique=True
    )
    repo_root_directory: Mapped[str] = mapped_column(
        String(500), default="/repos"
    )
    llm_provider: Mapped[str] = mapped_column(String(100), default="anthropic")
    llm_model: Mapped[str] = mapped_column(
        String(200), default="claude-sonnet-4-20250514"
    )
    health_thresholds: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    anthropic_api_key: Mapped[str | None] = mapped_column(String(500), nullable=True, default=None)
    ollama_base_url: Mapped[str | None] = mapped_column(String(500), nullable=True, default=None)
    commit_evaluation_criteria: Mapped[str] = mapped_column(
        Text, nullable=False, default=DEFAULT_COMMIT_EVALUATION_CRITERIA
    )

    # Relationships
    user: Mapped[object] = relationship(
        "User", back_populates="app_settings", lazy="selectin"
    )
