from __future__ import annotations

import enum
import uuid

from sqlalchemy import DateTime, Enum, ForeignKey, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base


class CollectionRole(str, enum.Enum):
    co_instructor = "co_instructor"
    ta = "ta"


class CollectionAccess(Base):
    __tablename__ = "collection_access"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    collection_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.id", ondelete="CASCADE"),
        nullable=False,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    access_role: Mapped[CollectionRole] = mapped_column(
        Enum(CollectionRole, name="collection_role", create_type=False),
        nullable=False,
    )
    created_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    __table_args__ = (
        UniqueConstraint("collection_id", "user_id", name="uq_collection_access_collection_user"),
    )

    # Relationships
    collection: Mapped[object] = relationship(
        "Collection", back_populates="access_entries", lazy="selectin"
    )
    user: Mapped[object] = relationship(
        "User", back_populates="collection_accesses", lazy="selectin"
    )
