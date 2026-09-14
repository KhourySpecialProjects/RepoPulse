"""Admin authorisation primitives in app.core.deps.

Before M2, app.core.deps exposes only get_db_session, get_db and
get_current_user — the latter returning a bare `sub` string that never touches
the database. Every admin route therefore re-fetches the User by hand. These
tests define the shared primitives that replace that duplication.

One behaviour here is deliberately inconsistent and must stay that way:
an unknown subject yields 401 from get_current_user_obj (the credential no
longer identifies anyone) but 403 from require_admin_user. The 403 preserves
what users._require_admin already does at its four call sites, which is what
lets it delegate without moving any existing test.
"""

from __future__ import annotations

import uuid

import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.routes.users import _require_admin
from app.core.deps import (
    get_current_user_obj,
    require_admin,
    require_admin_user,
    resolve_user,
)
from app.models.user import User


async def _make_user(db: AsyncSession, role: str, email: str) -> User:
    user = User(
        id=uuid.uuid4(),
        email=email,
        display_name=f"{role.title()} User",
        role=role,
        password_hash=None,
    )
    db.add(user)
    await db.flush()
    return user


# ---------------------------------------------------------------------------
# resolve_user
# ---------------------------------------------------------------------------


async def test_resolve_user_returns_the_row(
    db_session: AsyncSession, test_user: User
) -> None:
    resolved = await resolve_user(db_session, str(test_user.id))
    assert resolved is not None
    assert resolved.id == test_user.id


async def test_resolve_user_returns_none_for_a_non_uuid_subject(
    db_session: AsyncSession,
) -> None:
    assert await resolve_user(db_session, "not-a-uuid") is None


async def test_resolve_user_returns_none_for_an_unknown_user(
    db_session: AsyncSession,
) -> None:
    assert await resolve_user(db_session, str(uuid.uuid4())) is None


# ---------------------------------------------------------------------------
# get_current_user_obj
# ---------------------------------------------------------------------------


async def test_get_current_user_obj_returns_the_user_row(
    db_session: AsyncSession, test_user: User
) -> None:
    user = await get_current_user_obj(current_user_id=str(test_user.id), db=db_session)
    assert user.id == test_user.id
    assert user.role == "instructor"


async def test_get_current_user_obj_401s_for_a_subject_that_is_not_a_uuid(
    db_session: AsyncSession,
) -> None:
    """A malformed subject is a bad credential, not a server fault.

    The hand-rolled `uuid.UUID(current_user_id)` in the route modules raises
    ValueError here, which surfaces as a 500.
    """
    with pytest.raises(HTTPException) as exc_info:
        await get_current_user_obj(current_user_id="not-a-uuid", db=db_session)
    assert exc_info.value.status_code == 401


async def test_get_current_user_obj_401s_for_a_user_that_no_longer_exists(
    db_session: AsyncSession,
) -> None:
    with pytest.raises(HTTPException) as exc_info:
        await get_current_user_obj(current_user_id=str(uuid.uuid4()), db=db_session)
    assert exc_info.value.status_code == 401


# ---------------------------------------------------------------------------
# require_admin (FastAPI dependency)
# ---------------------------------------------------------------------------


async def test_require_admin_returns_the_admin(admin_user: User) -> None:
    assert await require_admin(user=admin_user) is admin_user


async def test_require_admin_403s_for_an_instructor(test_user: User) -> None:
    with pytest.raises(HTTPException) as exc_info:
        await require_admin(user=test_user)
    assert exc_info.value.status_code == 403
    assert exc_info.value.detail == "Forbidden"


async def test_require_admin_403s_for_a_ta(db_session: AsyncSession) -> None:
    ta = await _make_user(db_session, "ta", "ta-deps@example.com")
    with pytest.raises(HTTPException) as exc_info:
        await require_admin(user=ta)
    assert exc_info.value.status_code == 403


# ---------------------------------------------------------------------------
# require_admin_user (plain-async twin) and the users.py delegation
# ---------------------------------------------------------------------------


async def test_require_admin_user_returns_the_admin(
    db_session: AsyncSession, admin_user: User
) -> None:
    resolved = await require_admin_user(db_session, str(admin_user.id))
    assert resolved.id == admin_user.id


async def test_require_admin_user_403s_for_an_instructor(
    db_session: AsyncSession, test_user: User
) -> None:
    with pytest.raises(HTTPException) as exc_info:
        await require_admin_user(db_session, str(test_user.id))
    assert exc_info.value.status_code == 403


async def test_require_admin_user_403s_for_an_unknown_subject(
    db_session: AsyncSession,
) -> None:
    """403, not 401 — this is the divergence that keeps users.py unchanged."""
    with pytest.raises(HTTPException) as exc_info:
        await require_admin_user(db_session, str(uuid.uuid4()))
    assert exc_info.value.status_code == 403


async def test_require_admin_user_403s_for_a_non_uuid_subject(
    db_session: AsyncSession,
) -> None:
    with pytest.raises(HTTPException) as exc_info:
        await require_admin_user(db_session, "not-a-uuid")
    assert exc_info.value.status_code == 403


async def test_users_require_admin_still_admits_an_admin(
    db_session: AsyncSession, admin_user: User
) -> None:
    resolved = await _require_admin(db_session, str(admin_user.id))
    assert resolved.id == admin_user.id


async def test_users_require_admin_still_403s_for_an_instructor(
    db_session: AsyncSession, test_user: User
) -> None:
    with pytest.raises(HTTPException) as exc_info:
        await _require_admin(db_session, str(test_user.id))
    assert exc_info.value.status_code == 403


async def test_users_require_admin_still_403s_for_an_unknown_subject(
    db_session: AsyncSession,
) -> None:
    """Pins the delegation: the four users.py call sites must not change code."""
    with pytest.raises(HTTPException) as exc_info:
        await _require_admin(db_session, str(uuid.uuid4()))
    assert exc_info.value.status_code == 403
