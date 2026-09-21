"""Tests for user management routes."""
from __future__ import annotations

import uuid

import pytest
import pytest_asyncio
from passlib.hash import bcrypt

from app.core.auth import create_access_token
from app.models.user import User


def _make_token(user_id: uuid.UUID) -> str:
    return create_access_token({"sub": str(user_id)})


def _auth(user: User) -> dict[str, str]:
    return {"Authorization": f"Bearer {_make_token(user.id)}"}


@pytest_asyncio.fixture
async def admin(db_session):
    user = User(
        id=uuid.uuid4(),
        email="admin_users@test.com",
        display_name="Admin",
        role="admin",
        password_hash=bcrypt.hash("secret"),
    )
    db_session.add(user)
    await db_session.flush()
    return user


@pytest_asyncio.fixture
async def instructor(db_session):
    user = User(
        id=uuid.uuid4(),
        email="instructor@test.com",
        display_name="Instructor",
        role="instructor",
        password_hash=bcrypt.hash("secret"),
    )
    db_session.add(user)
    await db_session.flush()
    return user


@pytest_asyncio.fixture
async def ta(db_session):
    user = User(
        id=uuid.uuid4(),
        email="ta_users@test.com",
        display_name="TA User",
        role="ta",
        password_hash=bcrypt.hash("secret"),
    )
    db_session.add(user)
    await db_session.flush()
    return user


class TestGetMe:
    async def test_get_own_profile(self, test_client, test_user):
        resp = await test_client.get(
            "/api/v1/users/me", headers=_auth(test_user)
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == str(test_user.id)
        assert data["email"] == test_user.email
        assert "password_hash" not in data
        assert "github_token" not in data
        assert "github_token_configured" in data

    async def test_get_me_unauthenticated(self, test_client):
        resp = await test_client.get("/api/v1/users/me")
        assert resp.status_code == 401


class TestListUsers:
    async def test_admin_can_list_all_users(self, test_client, admin, instructor, ta):
        resp = await test_client.get("/api/v1/users", headers=_auth(admin))
        assert resp.status_code == 200
        data = resp.json()
        assert "items" in data
        ids = [u["id"] for u in data["items"]]
        assert str(admin.id) in ids
        assert str(instructor.id) in ids

    async def test_no_password_hash_in_response(self, test_client, admin):
        resp = await test_client.get("/api/v1/users", headers=_auth(admin))
        for user in resp.json()["items"]:
            assert "password_hash" not in user
            assert "github_token" not in user

    async def test_unauthenticated_rejected(self, test_client):
        resp = await test_client.get("/api/v1/users")
        assert resp.status_code == 401


class TestCreateUser:
    """Creation takes no password — it mints a setup link instead. The link
    itself is covered in test_account_setup.py."""

    async def test_admin_can_create_user(self, test_client, admin):
        resp = await test_client.post(
            "/api/v1/users",
            json={
                "email": "newuser@test.com",
                "display_name": "New User",
                "role": "instructor",
            },
            headers=_auth(admin),
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["user"]["email"] == "newuser@test.com"
        assert "password_hash" not in data["user"]
        assert "github_token" not in data["user"]

    async def test_admin_cannot_seed_a_github_token(
        self, test_client, db_session, admin
    ):
        """A token sent at creation is ignored, like a password would be."""
        resp = await test_client.post(
            "/api/v1/users",
            json={
                "email": "tokenless@test.com",
                "display_name": "Tokenless",
                "role": "instructor",
                "github_token": "ghp_set_by_an_admin",
            },
            headers=_auth(admin),
        )
        assert resp.status_code == 201
        assert resp.json()["user"]["github_token_configured"] is False
        created = await db_session.get(User, uuid.UUID(resp.json()["user"]["id"]))
        assert created.github_token is None

    async def test_non_admin_cannot_create_user(self, test_client, instructor):
        resp = await test_client.post(
            "/api/v1/users",
            json={
                "email": "another@test.com",
                "display_name": "Another",
                "role": "ta",
            },
            headers=_auth(instructor),
        )
        assert resp.status_code == 403

    async def test_duplicate_email_rejected(self, test_client, admin, instructor):
        resp = await test_client.post(
            "/api/v1/users",
            json={
                "email": instructor.email,
                "display_name": "Duplicate",
                "role": "ta",
            },
            headers=_auth(admin),
        )
        assert resp.status_code == 409


class TestGetUser:
    async def test_admin_gets_user_detail(self, test_client, admin, instructor):
        resp = await test_client.get(
            f"/api/v1/users/{instructor.id}", headers=_auth(admin)
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == str(instructor.id)
        assert "github_token_configured" in data

    async def test_user_gets_own_detail(self, test_client, instructor):
        resp = await test_client.get(
            f"/api/v1/users/{instructor.id}", headers=_auth(instructor)
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "github_token_configured" in data

    async def test_non_admin_gets_limited_view(self, test_client, instructor, ta):
        resp = await test_client.get(
            f"/api/v1/users/{ta.id}", headers=_auth(instructor)
        )
        assert resp.status_code == 200
        data = resp.json()
        # UserRead — no github_token_configured
        assert "github_token_configured" not in data

    async def test_nonexistent_user_returns_404(self, test_client, admin):
        resp = await test_client.get(
            f"/api/v1/users/{uuid.uuid4()}", headers=_auth(admin)
        )
        assert resp.status_code == 404


class TestUpdateUser:
    async def test_admin_can_update_role(self, test_client, admin, ta):
        resp = await test_client.patch(
            f"/api/v1/users/{ta.id}",
            json={"role": "instructor"},
            headers=_auth(admin),
        )
        assert resp.status_code == 200
        assert resp.json()["role"] == "instructor"

    async def test_non_admin_cannot_update_other(self, test_client, instructor, ta):
        resp = await test_client.patch(
            f"/api/v1/users/{ta.id}",
            json={"display_name": "Hacked"},
            headers=_auth(instructor),
        )
        assert resp.status_code == 403

    async def test_admin_cannot_set_a_github_token(self, test_client, admin, ta):
        """The PAT is the user's own — set at account setup or in Settings."""
        resp = await test_client.patch(
            f"/api/v1/users/{ta.id}",
            json={"github_token": "ghp_set_by_an_admin"},
            headers=_auth(admin),
        )
        assert resp.status_code == 200
        assert resp.json()["github_token_configured"] is False

    async def test_admin_cannot_overwrite_an_existing_github_token(
        self, test_client, db_session, admin, ta
    ):
        ta.github_token = "ghp_belongs_to_the_ta"
        await db_session.flush()
        resp = await test_client.patch(
            f"/api/v1/users/{ta.id}",
            json={"github_token": "ghp_set_by_an_admin"},
            headers=_auth(admin),
        )
        assert resp.status_code == 200
        await db_session.refresh(ta)
        assert ta.github_token == "ghp_belongs_to_the_ta"


class TestDeleteUser:
    async def test_admin_can_delete_other_user(self, test_client, admin, ta):
        resp = await test_client.delete(
            f"/api/v1/users/{ta.id}", headers=_auth(admin)
        )
        assert resp.status_code == 204

    async def test_admin_cannot_delete_self(self, test_client, admin):
        resp = await test_client.delete(
            f"/api/v1/users/{admin.id}", headers=_auth(admin)
        )
        assert resp.status_code == 400

    async def test_non_admin_cannot_delete(self, test_client, instructor, ta):
        resp = await test_client.delete(
            f"/api/v1/users/{ta.id}", headers=_auth(instructor)
        )
        assert resp.status_code == 403


# Admin-set passwords are gone. `POST /users/{id}/setup-link` replaces the old
# reset-password route; its access control and behaviour live in
# tests/api/test_account_setup.py.


class TestPatchMe:
    async def test_user_can_update_display_name(self, test_client, instructor):
        resp = await test_client.patch(
            "/api/v1/users/me",
            json={"display_name": "New Name"},
            headers=_auth(instructor),
        )
        assert resp.status_code == 200
        assert resp.json()["display_name"] == "New Name"

    async def test_user_can_set_github_token(self, test_client, instructor):
        resp = await test_client.patch(
            "/api/v1/users/me",
            json={"github_token": "ghp_abc123"},
            headers=_auth(instructor),
        )
        assert resp.status_code == 200
        assert resp.json()["github_token_configured"] is True

    async def test_user_can_clear_github_token(self, test_client, instructor):
        # Set first
        await test_client.patch(
            "/api/v1/users/me",
            json={"github_token": "ghp_abc123"},
            headers=_auth(instructor),
        )
        # Then clear
        resp = await test_client.patch(
            "/api/v1/users/me",
            json={"github_token": ""},
            headers=_auth(instructor),
        )
        assert resp.status_code == 200
        assert resp.json()["github_token_configured"] is False

    async def test_user_can_change_password(self, test_client, instructor):
        resp = await test_client.patch(
            "/api/v1/users/me",
            json={"change_password": {"current_password": "secret", "new_password": "newsecret"}},
            headers=_auth(instructor),
        )
        assert resp.status_code == 200

    async def test_wrong_current_password_rejected(self, test_client, instructor):
        resp = await test_client.patch(
            "/api/v1/users/me",
            json={"change_password": {"current_password": "wrong", "new_password": "newsecret"}},
            headers=_auth(instructor),
        )
        assert resp.status_code == 400
