from __future__ import annotations

import uuid

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base


class AccountSetupToken(Base):
    """A single-use link letting someone set their own password.

    Admins create accounts but never choose a password for the person: creating
    a user mints one of these, the admin passes the link on, and the recipient
    sets their own password. The same row type backs password reset, so there
    is one code path rather than two.

    `token_hash` holds `sha256(raw)`, not a bcrypt digest. Lookup has to happen
    *by* the hash, which needs a deterministic one — bcrypt salts every call and
    would force a table scan plus a verify per row. That is safe here in a way
    it would not be for a password: the raw token is `secrets.token_urlsafe(32)`,
    so there is no small candidate space to brute-force. Keep it that way; a
    "fix" to bcrypt breaks lookup, and a switch to a lower-entropy token breaks
    the reasoning that makes sha256 acceptable.

    Deliberately not a JWT. `app.core.auth.verify_token` validates no purpose
    claim, so any JWT this app mints is accepted as a session bearer token —
    a setup link minted that way would be a full credential for the account it
    was meant to bootstrap. An opaque row cannot be replayed at the API.

    There is no reverse `User.setup_tokens` relationship on purpose. Every
    relationship on `User` is `lazy="selectin"` and `get_current_user_obj`
    loads a `User` on every authenticated request, so a reverse side would add
    a query to every API call. Cleanup on user deletion comes from the
    database-level `ondelete="CASCADE"` below instead.
    """

    __tablename__ = "account_setup_tokens"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    token_hash: Mapped[str] = mapped_column(
        String(64), nullable=False, unique=True, index=True
    )
    expires_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    # Non-null means spent. Rows are kept rather than deleted so a second click
    # on an already-used link is answered deliberately instead of looking like
    # an unknown token.
    used_at: Mapped[DateTime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    user: Mapped["User"] = relationship("User", lazy="selectin")  # noqa: F821
