from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, JSON, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.config import settings
from app.db.database import Base


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
        String(200), default=settings.DEFAULT_LLM_MODEL
    )
    health_thresholds: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    anthropic_api_key: Mapped[str | None] = mapped_column(String(500), nullable=True, default=None)
    ollama_base_url: Mapped[str | None] = mapped_column(String(500), nullable=True, default=None)
    # The instructor's optional grading rubric, as an ADDENDUM to the built-in
    # criteria in commit_classifier_service — not a replacement for them.
    # Defaults to empty rather than to a seeded rubric: with no text here the
    # classifier prompt is byte-identical to the one the accuracy gate in
    # tests/test_commit_classifier_eval.py measures, so opting in is a
    # deliberate act and the default path stays the measured path.
    commit_evaluation_criteria: Mapped[str] = mapped_column(
        Text, nullable=False, default="", server_default=""
    )

    # Relationships
    user: Mapped[object] = relationship(
        "User", back_populates="app_settings", lazy="selectin"
    )
