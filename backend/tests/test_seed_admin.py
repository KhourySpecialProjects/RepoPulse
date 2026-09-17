"""Tests for `app.db.seed_admin` — bootstrapping the first administrator.

This script exists because `POST /api/v1/users` is admin-gated: on a fresh
deployment there is nobody who can create the first admin. The tests below
pin the two things that make it safe to run against a live instance — it
never touches rows other than the one account, and the credential it sets is
one the real login route accepts.
"""
from __future__ import annotations

import uuid

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.db.seed_admin import MIN_PASSWORD_LENGTH, seed_admin
from app.models.account_setup_token import AccountSetupToken
from app.models.user import User
from app.services.account_setup_service import resolve_setup_token


async def test_creates_admin_whose_password_the_login_route_accepts(
    db_session: AsyncSession, test_client
) -> None:
    """The point of the script: an account that can actually sign in."""
    await seed_admin(
        db_session,
        email="first.admin@example.com",
        display_name="First Admin",
        password="correct-horse-battery",
    )

    response = await test_client.post(
        "/api/v1/auth/login",
        json={"email": "first.admin@example.com", "password": "correct-horse-battery"},
    )

    assert response.status_code == 200
    assert response.json()["role"] == "admin"


async def test_wrong_password_is_still_rejected(
    db_session: AsyncSession, test_client
) -> None:
    """Guards against a hash the verifier treats as a match for anything."""
    await seed_admin(
        db_session,
        email="first.admin@example.com",
        display_name="First Admin",
        password="correct-horse-battery",
    )

    response = await test_client.post(
        "/api/v1/auth/login",
        json={"email": "first.admin@example.com", "password": "wrong"},
    )

    assert response.status_code == 401


async def test_without_a_password_mints_a_usable_setup_link(
    db_session: AsyncSession,
) -> None:
    """The password-free path, so no credential is typed into a deploy console."""
    user, raw_token = await seed_admin(
        db_session, email="first.admin@example.com", display_name="First Admin"
    )

    assert user.role == "admin"
    assert user.password_hash is None
    assert raw_token is not None

    token = await resolve_setup_token(db_session, raw_token)
    assert token.user_id == user.id


async def test_setup_token_is_not_stored_in_readable_form(
    db_session: AsyncSession,
) -> None:
    """A raw token in the table would make DB read access account access."""
    _, raw_token = await seed_admin(
        db_session, email="first.admin@example.com", display_name="First Admin"
    )

    stored = (await db_session.execute(select(AccountSetupToken))).scalars().all()
    assert len(stored) == 1
    assert stored[0].token_hash != raw_token


async def test_promotes_an_existing_account_instead_of_duplicating_it(
    db_session: AsyncSession,
) -> None:
    """Re-running is the recovery path for a locked-out or demoted admin."""
    existing = User(
        id=uuid.uuid4(),
        email="instructor@example.com",
        display_name="Existing Instructor",
        role="instructor",
        password_hash=None,
    )
    db_session.add(existing)
    await db_session.flush()

    user, _ = await seed_admin(
        db_session,
        email="instructor@example.com",
        display_name="Ignored When The Account Exists",
        password="brand-new-password",
    )

    assert user.id == existing.id
    assert user.role == "admin"
    # The display name the admin already chose is theirs, not the script's.
    assert user.display_name == "Existing Instructor"

    count = await db_session.scalar(
        select(func.count()).select_from(User).where(
            User.email == "instructor@example.com"
        )
    )
    assert count == 1


async def test_running_twice_leaves_one_live_setup_token(
    db_session: AsyncSession,
) -> None:
    """Two live links would mean a superseded link still opens the account."""
    _, first = await seed_admin(
        db_session, email="first.admin@example.com", display_name="First Admin"
    )
    _, second = await seed_admin(
        db_session, email="first.admin@example.com", display_name="First Admin"
    )

    assert first != second
    with pytest.raises(AppError):
        await resolve_setup_token(db_session, first)
    assert (await resolve_setup_token(db_session, second)) is not None


async def test_rejects_a_password_shorter_than_the_api_minimum(
    db_session: AsyncSession,
) -> None:
    """The script must not be a way around `CompleteSetupRequest`'s floor."""
    with pytest.raises(ValueError):
        await seed_admin(
            db_session,
            email="first.admin@example.com",
            display_name="First Admin",
            password="x" * (MIN_PASSWORD_LENGTH - 1),
        )

    assert (await db_session.execute(select(User))).scalars().first() is None


async def test_leaves_other_rows_alone(db_session: AsyncSession) -> None:
    """Unlike `app.db.seed`, this script must never truncate."""
    bystander = User(
        id=uuid.uuid4(),
        email="bystander@example.com",
        display_name="Bystander",
        role="ta",
        password_hash="preexisting-hash",
    )
    db_session.add(bystander)
    await db_session.flush()

    await seed_admin(
        db_session,
        email="first.admin@example.com",
        display_name="First Admin",
        password="correct-horse-battery",
    )

    still_there = await db_session.get(User, bystander.id)
    assert still_there is not None
    assert still_there.role == "ta"
    assert still_there.password_hash == "preexisting-hash"
