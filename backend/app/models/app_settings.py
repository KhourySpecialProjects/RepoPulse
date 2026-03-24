from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, JSON, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

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
        String(200), default="claude-sonnet-4-20250514"
    )
    health_thresholds: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    anthropic_api_key: Mapped[str | None] = mapped_column(String(500), nullable=True, default=None)
    ollama_base_url: Mapped[str | None] = mapped_column(String(500), nullable=True, default=None)

    # Relationships
    user: Mapped[object] = relationship(
        "User", back_populates="app_settings", lazy="selectin"
    )
