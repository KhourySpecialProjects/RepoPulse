"""Bootstrap the instance's first administrator.

Usage (inside the backend container):

    ADMIN_EMAIL=you@example.com python -m app.db.seed_admin

    # or set the password in the same command instead of using a setup link
    ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='...' python -m app.db.seed_admin

Environment:
    ADMIN_EMAIL     required — the account to create or promote
    ADMIN_NAME      optional — display name for a new account (default below)
    ADMIN_PASSWORD  optional — omit to get a one-time setup link instead

This exists because `POST /api/v1/users` is admin-gated: it can mint an
account for anyone except the first admin, who has nobody to authorize them.
`app.db.seed` cannot serve that role on a deployment either — it truncates
every table. This script writes exactly one user row and, when no password is
given, one setup token.

Re-running it is the recovery path for an admin who is locked out or was
demoted, so an existing account is promoted rather than refused.
"""
from __future__ import annotations

import asyncio
import os
import uuid

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings
import app.models  # noqa: F401 — register all models before the ORM is used
from app.models.user import User
from app.services.account_setup_service import build_setup_path, issue_setup_token

DEFAULT_DISPLAY_NAME = "Administrator"

# Mirrors `CompleteSetupRequest.new_password`'s Field(min_length=8). A script
# with a laxer floor than the API would be the easy way to give the most
# privileged account on the instance the weakest password on it.
MIN_PASSWORD_LENGTH = 8


async def seed_admin(
    db: AsyncSession,
    *,
    email: str,
    display_name: str = DEFAULT_DISPLAY_NAME,
    password: str | None = None,
) -> tuple[User, str | None]:
    """Ensure `email` exists as an admin. Returns the user and any raw token.

    With a `password`, the account is ready to log in. Without one, the
    password is left untouched and a setup link is minted instead — the raw
    token comes back as the second element, the only moment it is readable,
    and the caller must print it and store it nowhere.

    `display_name` applies to a newly created account only. Overwriting the
    name on an existing one would rename a real person as a side effect of an
    unrelated password reset.
    """
    if password is not None and len(password) < MIN_PASSWORD_LENGTH:
        # Before any write, so a rejected password leaves no half-made account.
        raise ValueError(
            f"Password must be at least {MIN_PASSWORD_LENGTH} characters."
        )

    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()

    if user is None:
        user = User(
            id=uuid.uuid4(),
            email=email,
            display_name=display_name,
            role="admin",
            password_hash=None,
        )
        db.add(user)
    else:
        user.role = "admin"

    # The users row has to land before a token can reference it.
    await db.flush()

    raw_token: str | None = None
    if password is not None:
        # passlib, matching account_setup_service.complete_setup and users.py,
        # so every hash in the column comes from the same backend the login
        # route verifies with.
        from passlib.hash import bcrypt

        user.password_hash = bcrypt.hash(password)
    else:
        raw_token, _ = await issue_setup_token(db, user)

    await db.flush()
    return user, raw_token


async def main() -> None:
    email = os.environ.get("ADMIN_EMAIL", "").strip()
    if not email:
        raise SystemExit(
            "ADMIN_EMAIL is required. Example:\n"
            "  ADMIN_EMAIL=you@example.com python -m app.db.seed_admin"
        )

    display_name = os.environ.get("ADMIN_NAME", "").strip() or DEFAULT_DISPLAY_NAME
    password = os.environ.get("ADMIN_PASSWORD") or None

    engine = create_async_engine(settings.DATABASE_URL, echo=False)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    try:
        async with engine.connect() as conn:
            # Same guard as app.db.seed: a missing schema otherwise surfaces as
            # a bare UndefinedTableError with no hint about what to run.
            if (
                await conn.execute(text("SELECT to_regclass('public.users')"))
            ).scalar() is None:
                raise SystemExit(
                    "No schema found. Run `alembic upgrade head` before "
                    "seeding (the backend container does this on boot)."
                )

        async with session_factory() as db:
            try:
                user, raw_token = await seed_admin(
                    db, email=email, display_name=display_name, password=password
                )
            except ValueError as exc:
                raise SystemExit(str(exc))
            await db.commit()

            print(f"Admin ready: {user.email} ({user.display_name})")
            print(f"  user_id: {user.id}")
            if raw_token is None:
                print("  password: the ADMIN_PASSWORD you passed — sign in at /login")
            else:
                print(
                    "  no password set. Open this path on the deployment to "
                    "choose one (valid 48h, single use):"
                )
                print(f"  {build_setup_path(raw_token)}")
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
