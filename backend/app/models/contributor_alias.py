from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base


class ContributorAlias(Base):
    __tablename__ = "contributor_aliases"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    contributor_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("contributors.id"), nullable=False
    )
    git_email: Mapped[str] = mapped_column(String(255), nullable=False)
    git_name: Mapped[str] = mapped_column(String(255), nullable=False)

    # Relationships
    contributor: Mapped[object] = relationship(
        "Contributor", back_populates="aliases", lazy="selectin"
    )
