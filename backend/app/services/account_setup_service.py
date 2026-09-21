"""Issuing and redeeming account setup links.

One module owns the whole lifecycle so the three entry points that touch setup
links — create user, generate link, redeem link — cannot drift from each other
on expiry, single-use, or the wording of a rejection.
"""
from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.models.account_setup_token import AccountSetupToken
from app.models.user import User

# Long enough that a link sent on a Friday is still good on Monday, short
# enough that a link forwarded into a mailing list archive goes stale. A
# constant rather than a setting: nothing has asked to vary it per instance,
# and an unset env var silently changing account security is worse than an
# edit here.
SETUP_TOKEN_TTL = timedelta(hours=48)

# Every rejection reads the same, whether the token is unknown, already spent,
# or past its expiry. Naming the reason would let someone probe which of their
# guesses corresponded to real tokens.
INVALID_TOKEN_DETAIL = "This setup link is invalid or has expired."
INVALID_TOKEN_CODE = "SETUP_TOKEN_INVALID"

# 32 bytes of entropy, urlsafe-encoded so it survives a query string intact.
_TOKEN_BYTES = 32


def hash_setup_token(raw: str) -> str:
    """Return the stored form of a raw token.

    See `AccountSetupToken` for why this is sha256 and not bcrypt.
    """
    return hashlib.sha256(raw.encode()).hexdigest()


def build_setup_path(raw: str) -> str:
    """The frontend route that redeems `raw`.

    A path, not an absolute URL: there is no configured public origin for this
    app, and the admin's browser already knows its own. Inventing a
    `FRONTEND_URL` setting would add a way to generate links that point
    somewhere nobody is serving.
    """
    return f"/account-setup?token={raw}"


async def issue_setup_token(
    db: AsyncSession, user: User
) -> tuple[str, AccountSetupToken]:
    """Mint a link for `user`, invalidating any it already had.

    Returns the raw token — the only moment it exists in readable form — and
    the persisted row. Callers must put the raw value in the response and
    nowhere else: not a log line, not an error message.
    """
    now = datetime.now(timezone.utc)

    # Only the newest link works. Two live links would mean a revoked one still
    # opens the account, which is the opposite of what re-issuing is for.
    outstanding = await db.execute(
        select(AccountSetupToken).where(
            AccountSetupToken.user_id == user.id,
            AccountSetupToken.used_at.is_(None),
        )
    )
    for row in outstanding.scalars().all():
        row.used_at = now

    raw = secrets.token_urlsafe(_TOKEN_BYTES)
    token = AccountSetupToken(
        user_id=user.id,
        token_hash=hash_setup_token(raw),
        expires_at=now + SETUP_TOKEN_TTL,
    )
    db.add(token)
    await db.flush()
    return raw, token


async def resolve_setup_token(db: AsyncSession, raw: str) -> AccountSetupToken:
    """Return the live token matching `raw`, or raise.

    Unknown, spent, and expired all raise the same `AppError`.
    """
    if not raw:
        raise AppError(400, INVALID_TOKEN_DETAIL, INVALID_TOKEN_CODE)

    result = await db.execute(
        select(AccountSetupToken).where(
            AccountSetupToken.token_hash == hash_setup_token(raw)
        )
    )
    token = result.scalar_one_or_none()

    if token is None or token.used_at is not None:
        raise AppError(400, INVALID_TOKEN_DETAIL, INVALID_TOKEN_CODE)

    if _as_aware(token.expires_at) <= datetime.now(timezone.utc):
        raise AppError(400, INVALID_TOKEN_DETAIL, INVALID_TOKEN_CODE)

    return token


async def complete_setup(
    db: AsyncSession,
    raw: str,
    new_password: str,
    github_token: str | None = None,
) -> User:
    """Set the password the token's owner chose and spend the token.

    `github_token` is written only when it has a value. A blank one means the
    recipient left the optional field alone, which must not wipe a token an
    existing user already has — this link is also how a password is reset.
    """
    # Imported here to match users.py, which hashes with the same backend.
    from passlib.hash import bcrypt

    token = await resolve_setup_token(db, raw)
    user = await db.get(User, token.user_id)
    if user is None:
        # The FK cascades, so this means the row went away mid-request.
        raise AppError(400, INVALID_TOKEN_DETAIL, INVALID_TOKEN_CODE)

    user.password_hash = bcrypt.hash(new_password)
    if github_token:
        user.github_token = github_token
    token.used_at = datetime.now(timezone.utc)

    await db.flush()
    await db.commit()
    await db.refresh(user)
    return user


def _as_aware(value: datetime) -> datetime:
    """Treat a naive timestamp as UTC.

    The column is `timezone=True`, but a row written and read back inside one
    session can still surface as naive depending on the driver, and comparing
    naive to aware raises.
    """
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value
