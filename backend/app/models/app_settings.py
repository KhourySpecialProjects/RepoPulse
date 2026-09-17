from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, JSON, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base


class AppSettings(Base):
    """Per-user preferences.

    Notably *not* here any more: llm_provider, llm_model, anthropic_api_key
    and ollama_base_url. Which model the instance talks to and which key pays
    for it are instance-wide and admin-only — see models/llm_config.py.
    Migration 0010 dropped those four columns rather than leaving them unread,
    so there is exactly one place a model id or a key can come from.

    The grading rubric below stays per-user: it is the instructor's editorial
    judgement about their own students, not a billing or provider concern.
    """

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
    health_thresholds: Mapped[dict | None] = mapped_column(JSON, nullable=True)
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
