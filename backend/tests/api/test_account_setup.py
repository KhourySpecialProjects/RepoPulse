"""Tests for admin-issued account setup links.

Admins never choose a password for someone else. Creating a user mints a
single-use setup link; the admin passes it on out-of-band and the recipient
sets their own password. The same endpoint doubles as password reset.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest_asyncio
from passlib.hash import bcrypt
from sqlalchemy import select

from app.core.auth import create_access_token
from app.models.account_setup_token import AccountSetupToken
from app.models.user import User
from app.services.account_setup_service import (
    SETUP_TOKEN_TTL,
    hash_setup_token,
    issue_setup_token,
)

VERIFY = "/api/v1/auth/account-setup/verify"
COMPLETE = "/api/v1/auth/account-setup/complete"

# Every rejection says exactly this, whether the token is unknown, already
# used, or expired. See test_rejection_detail_is_identical_for_every_cause.
INVALID_DETAIL = "This setup link is invalid or has expired."


def _auth(user: User) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token({'sub': str(user.id)})}"}


@pytest_asyncio.fixture
async def admin(db_session):
    user = User(
        id=uuid.uuid4(),
        email="admin_setup@test.com",
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
        email="instructor_setup@test.com",
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
        email="ta_setup@test.com",
        display_name="TA",
        role="ta",
        password_hash=bcrypt.hash("secret"),
    )
    db_session.add(user)
    await db_session.flush()
    return user


@pytest_asyncio.fixture
async def pending_user(db_session):
    """A user created by an admin who has not set a password yet."""
    user = User(
        id=uuid.uuid4(),
        email="pending@test.com",
        display_name="Pending Person",
        role="ta",
        password_hash=None,
    )
    db_session.add(user)
    await db_session.flush()
    return user


async def _create_user(test_client, admin, **overrides) -> dict:
    """POST /users as the admin and return the parsed envelope."""
    body = {
        "email": "newuser@test.com",
        "display_name": "New User",
        "role": "ta",
    }
    body.update(overrides)
    resp = await test_client.post("/api/v1/users", json=body, headers=_auth(admin))
    assert resp.status_code == 201, resp.text
    return resp.json()


class TestCreateUserIssuesLink:
    async def test_create_user_needs_no_password(self, test_client, admin):
        data = await _create_user(test_client, admin)
        assert data["user"]["email"] == "newuser@test.com"
        assert data["setup"]["token"]
        assert "password_hash" not in data["user"]

    async def test_created_user_has_no_password(self, test_client, admin, db_session):
        data = await _create_user(test_client, admin)
        user = await db_session.get(User, uuid.UUID(data["user"]["id"]))
        assert user.password_hash is None

    async def test_setup_path_carries_the_token(self, test_client, admin):
        data = await _create_user(test_client, admin)
        token = data["setup"]["token"]
        assert data["setup"]["setup_path"] == f"/account-setup?token={token}"

    async def test_raw_token_is_not_stored(self, test_client, admin, db_session):
        """Only the hash is persisted, so a DB leak yields no usable links."""
        data = await _create_user(test_client, admin)
        raw = data["setup"]["token"]
        rows = (await db_session.execute(select(AccountSetupToken))).scalars().all()
        assert len(rows) == 1
        assert rows[0].token_hash != raw
        assert rows[0].token_hash == hash_setup_token(raw)

    async def test_expiry_is_the_configured_ttl(self, test_client, admin):
        data = await _create_user(test_client, admin)
        expires_at = datetime.fromisoformat(data["setup"]["expires_at"])
        expected = datetime.now(timezone.utc) + SETUP_TOKEN_TTL
        assert abs((expires_at - expected).total_seconds()) < 60

    async def test_password_field_is_ignored_if_sent(
        self, test_client, admin, db_session
    ):
        """A stale client cannot smuggle a password back in."""
        data = await _create_user(test_client, admin, password="hunter2")
        user = await db_session.get(User, uuid.UUID(data["user"]["id"]))
        assert user.password_hash is None

    async def test_non_admin_cannot_create_user(self, test_client, instructor):
        resp = await test_client.post(
            "/api/v1/users",
            json={"email": "x@test.com", "display_name": "X", "role": "ta"},
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


class TestVerify:
    async def test_verify_returns_who_the_link_is_for(
        self, test_client, db_session, pending_user
    ):
        raw, _ = await issue_setup_token(db_session, pending_user)
        resp = await test_client.post(VERIFY, json={"token": raw})
        assert resp.status_code == 200
        data = resp.json()
        assert data["email"] == pending_user.email
        assert data["display_name"] == pending_user.display_name
        assert data["expires_at"]

    async def test_verify_does_not_consume_the_token(
        self, test_client, db_session, pending_user
    ):
        raw, _ = await issue_setup_token(db_session, pending_user)
        await test_client.post(VERIFY, json={"token": raw})
        second = await test_client.post(VERIFY, json={"token": raw})
        assert second.status_code == 200

    async def test_verify_needs_no_auth_header(
        self, test_client, db_session, pending_user
    ):
        raw, _ = await issue_setup_token(db_session, pending_user)
        resp = await test_client.post(VERIFY, json={"token": raw})
        assert resp.status_code == 200

    async def test_unknown_token_rejected(self, test_client):
        resp = await test_client.post(VERIFY, json={"token": "not-a-real-token"})
        assert resp.status_code == 400
        assert resp.json()["error_code"] == "SETUP_TOKEN_INVALID"

    async def test_rejection_is_400_not_401(self, test_client):
        """401 would trip the frontend's global interceptor and redirect the
        user away from the setup page before they could read the error."""
        resp = await test_client.post(VERIFY, json={"token": "nope"})
        assert resp.status_code == 400

    async def test_expired_token_rejected(self, test_client, db_session, pending_user):
        raw, row = await issue_setup_token(db_session, pending_user)
        row.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
        await db_session.flush()
        resp = await test_client.post(VERIFY, json={"token": raw})
        assert resp.status_code == 400

    async def test_used_token_rejected(self, test_client, db_session, pending_user):
        raw, row = await issue_setup_token(db_session, pending_user)
        row.used_at = datetime.now(timezone.utc)
        await db_session.flush()
        resp = await test_client.post(VERIFY, json={"token": raw})
        assert resp.status_code == 400

    async def test_rejection_detail_is_identical_for_every_cause(
        self, test_client, db_session, pending_user
    ):
        """Unknown vs expired vs used must be indistinguishable — a differing
        message tells an attacker which guesses were real tokens."""
        expired_raw, expired_row = await issue_setup_token(db_session, pending_user)
        expired_row.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
        used_raw, used_row = await issue_setup_token(db_session, pending_user)
        used_row.used_at = datetime.now(timezone.utc)
        await db_session.flush()

        details = set()
        for token in ("totally-unknown", expired_raw, used_raw):
            resp = await test_client.post(VERIFY, json={"token": token})
            assert resp.status_code == 400
            body = resp.json()
            assert body["error_code"] == "SETUP_TOKEN_INVALID"
            details.add(body["detail"])

        assert details == {INVALID_DETAIL}


class TestComplete:
    async def test_complete_sets_the_password(
        self, test_client, db_session, pending_user
    ):
        raw, _ = await issue_setup_token(db_session, pending_user)
        resp = await test_client.post(
            COMPLETE, json={"token": raw, "new_password": "chosen-password"}
        )
        assert resp.status_code == 200
        await db_session.refresh(pending_user)
        assert pending_user.password_hash is not None
        assert bcrypt.verify("chosen-password", pending_user.password_hash)

    async def test_complete_logs_the_user_in(
        self, test_client, db_session, pending_user
    ):
        raw, _ = await issue_setup_token(db_session, pending_user)
        resp = await test_client.post(
            COMPLETE, json={"token": raw, "new_password": "chosen-password"}
        )
        data = resp.json()
        assert data["token_type"] == "bearer"
        assert data["user_id"] == str(pending_user.id)
        assert data["display_name"] == pending_user.display_name
        assert data["role"] == pending_user.role

        me = await test_client.get(
            "/api/v1/users/me",
            headers={"Authorization": f"Bearer {data['access_token']}"},
        )
        assert me.status_code == 200
        assert me.json()["email"] == pending_user.email

    async def test_password_then_works_at_login(
        self, test_client, db_session, pending_user
    ):
        raw, _ = await issue_setup_token(db_session, pending_user)
        await test_client.post(
            COMPLETE, json={"token": raw, "new_password": "chosen-password"}
        )
        resp = await test_client.post(
            "/api/v1/auth/login",
            json={"email": pending_user.email, "password": "chosen-password"},
        )
        assert resp.status_code == 200

    async def test_token_is_single_use(self, test_client, db_session, pending_user):
        raw, _ = await issue_setup_token(db_session, pending_user)
        first = await test_client.post(
            COMPLETE, json={"token": raw, "new_password": "first-password"}
        )
        assert first.status_code == 200
        second = await test_client.post(
            COMPLETE, json={"token": raw, "new_password": "second-password"}
        )
        assert second.status_code == 400
        await db_session.refresh(pending_user)
        assert bcrypt.verify("first-password", pending_user.password_hash)

    async def test_complete_stamps_used_at(
        self, test_client, db_session, pending_user
    ):
        raw, row = await issue_setup_token(db_session, pending_user)
        await test_client.post(
            COMPLETE, json={"token": raw, "new_password": "chosen-password"}
        )
        await db_session.refresh(row)
        assert row.used_at is not None

    async def test_expired_token_cannot_complete(
        self, test_client, db_session, pending_user
    ):
        raw, row = await issue_setup_token(db_session, pending_user)
        row.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
        await db_session.flush()
        resp = await test_client.post(
            COMPLETE, json={"token": raw, "new_password": "chosen-password"}
        )
        assert resp.status_code == 400
        await db_session.refresh(pending_user)
        assert pending_user.password_hash is None

    async def test_short_password_rejected(
        self, test_client, db_session, pending_user
    ):
        raw, _ = await issue_setup_token(db_session, pending_user)
        resp = await test_client.post(
            COMPLETE, json={"token": raw, "new_password": "short"}
        )
        assert resp.status_code == 422
        await db_session.refresh(pending_user)
        assert pending_user.password_hash is None

    async def test_rejected_password_does_not_consume_the_token(
        self, test_client, db_session, pending_user
    ):
        """A too-short password must not burn the link."""
        raw, _ = await issue_setup_token(db_session, pending_user)
        await test_client.post(COMPLETE, json={"token": raw, "new_password": "short"})
        resp = await test_client.post(
            COMPLETE, json={"token": raw, "new_password": "long-enough"}
        )
        assert resp.status_code == 200


class TestCompleteAcceptsAGitHubToken:
    """The recipient supplies their own PAT, if they have one.

    An admin never types it: the credential is the user's, and a link the
    admin already holds is not a reason for them to learn a second secret.
    The field is optional at every step, and blank never clears a token that
    is already there — the same link doubles as password reset.
    """

    async def test_token_is_stored_when_supplied(
        self, test_client, db_session, pending_user
    ):
        raw, _ = await issue_setup_token(db_session, pending_user)
        resp = await test_client.post(
            COMPLETE,
            json={
                "token": raw,
                "new_password": "chosen-password",
                "github_token": "ghp_from_the_recipient",
            },
        )
        assert resp.status_code == 200
        await db_session.refresh(pending_user)
        assert pending_user.github_token == "ghp_from_the_recipient"

    async def test_omitting_the_field_leaves_no_token(
        self, test_client, db_session, pending_user
    ):
        raw, _ = await issue_setup_token(db_session, pending_user)
        resp = await test_client.post(
            COMPLETE, json={"token": raw, "new_password": "chosen-password"}
        )
        assert resp.status_code == 200
        await db_session.refresh(pending_user)
        assert pending_user.github_token is None

    async def test_omitting_the_field_keeps_an_existing_token(
        self, test_client, db_session, pending_user
    ):
        """Redeeming a reset link is not a request to drop the PAT."""
        pending_user.github_token = "ghp_already_mine"
        await db_session.flush()
        raw, _ = await issue_setup_token(db_session, pending_user)
        resp = await test_client.post(
            COMPLETE, json={"token": raw, "new_password": "chosen-password"}
        )
        assert resp.status_code == 200
        await db_session.refresh(pending_user)
        assert pending_user.github_token == "ghp_already_mine"

    async def test_blank_field_keeps_an_existing_token(
        self, test_client, db_session, pending_user
    ):
        """The form submits "" for an untouched input; treat it as untouched."""
        pending_user.github_token = "ghp_already_mine"
        await db_session.flush()
        raw, _ = await issue_setup_token(db_session, pending_user)
        resp = await test_client.post(
            COMPLETE,
            json={
                "token": raw,
                "new_password": "chosen-password",
                "github_token": "",
            },
        )
        assert resp.status_code == 200
        await db_session.refresh(pending_user)
        assert pending_user.github_token == "ghp_already_mine"

    async def test_a_new_token_replaces_the_old_one(
        self, test_client, db_session, pending_user
    ):
        pending_user.github_token = "ghp_stale"
        await db_session.flush()
        raw, _ = await issue_setup_token(db_session, pending_user)
        await test_client.post(
            COMPLETE,
            json={
                "token": raw,
                "new_password": "chosen-password",
                "github_token": "ghp_fresh",
            },
        )
        await db_session.refresh(pending_user)
        assert pending_user.github_token == "ghp_fresh"

    async def test_the_pat_is_never_echoed_back(
        self, test_client, db_session, pending_user
    ):
        raw, _ = await issue_setup_token(db_session, pending_user)
        resp = await test_client.post(
            COMPLETE,
            json={
                "token": raw,
                "new_password": "chosen-password",
                "github_token": "ghp_from_the_recipient",
            },
        )
        assert "ghp_from_the_recipient" not in resp.text

    async def test_a_rejected_password_does_not_store_the_pat(
        self, test_client, db_session, pending_user
    ):
        """Nothing is written when the link is not actually redeemed."""
        raw, _ = await issue_setup_token(db_session, pending_user)
        resp = await test_client.post(
            COMPLETE,
            json={"token": raw, "new_password": "short", "github_token": "ghp_x"},
        )
        assert resp.status_code == 422
        await db_session.refresh(pending_user)
        assert pending_user.github_token is None


class TestSetupTokenIsNotACredential:
    async def test_raw_token_is_not_accepted_as_a_bearer_token(
        self, test_client, db_session, pending_user
    ):
        """`verify_token` checks no purpose claim, so a JWT minted for setup
        would be a full session credential. The token is an opaque random
        string precisely so it cannot be replayed at the API."""
        raw, _ = await issue_setup_token(db_session, pending_user)
        resp = await test_client.get(
            "/api/v1/users/me", headers={"Authorization": f"Bearer {raw}"}
        )
        assert resp.status_code == 401

    async def test_token_hash_is_not_accepted_as_a_bearer_token(
        self, test_client, db_session, pending_user
    ):
        raw, _ = await issue_setup_token(db_session, pending_user)
        resp = await test_client.get(
            "/api/v1/users/me",
            headers={"Authorization": f"Bearer {hash_setup_token(raw)}"},
        )
        assert resp.status_code == 401


class TestGenerateSetupLink:
    async def test_admin_can_generate_a_link(self, test_client, admin, instructor):
        resp = await test_client.post(
            f"/api/v1/users/{instructor.id}/setup-link", headers=_auth(admin)
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["token"]
        assert data["setup_path"] == f"/account-setup?token={data['token']}"

    async def test_generated_link_resets_the_password(
        self, test_client, db_session, admin, instructor
    ):
        resp = await test_client.post(
            f"/api/v1/users/{instructor.id}/setup-link", headers=_auth(admin)
        )
        raw = resp.json()["token"]
        done = await test_client.post(
            COMPLETE, json={"token": raw, "new_password": "brand-new-password"}
        )
        assert done.status_code == 200
        await db_session.refresh(instructor)
        assert bcrypt.verify("brand-new-password", instructor.password_hash)

    async def test_existing_password_still_works_until_link_is_used(
        self, test_client, admin, instructor
    ):
        """Generating a link must not lock the user out of their account."""
        await test_client.post(
            f"/api/v1/users/{instructor.id}/setup-link", headers=_auth(admin)
        )
        resp = await test_client.post(
            "/api/v1/auth/login",
            json={"email": instructor.email, "password": "secret"},
        )
        assert resp.status_code == 200

    async def test_reissuing_invalidates_the_previous_link(
        self, test_client, admin, instructor
    ):
        first = await test_client.post(
            f"/api/v1/users/{instructor.id}/setup-link", headers=_auth(admin)
        )
        second = await test_client.post(
            f"/api/v1/users/{instructor.id}/setup-link", headers=_auth(admin)
        )
        old_token = first.json()["token"]
        new_token = second.json()["token"]
        assert old_token != new_token

        stale = await test_client.post(VERIFY, json={"token": old_token})
        assert stale.status_code == 400
        fresh = await test_client.post(VERIFY, json={"token": new_token})
        assert fresh.status_code == 200

    async def test_instructor_cannot_generate_a_link(
        self, test_client, instructor, ta
    ):
        resp = await test_client.post(
            f"/api/v1/users/{ta.id}/setup-link", headers=_auth(instructor)
        )
        assert resp.status_code == 403

    async def test_ta_cannot_generate_a_link(self, test_client, ta, instructor):
        resp = await test_client.post(
            f"/api/v1/users/{instructor.id}/setup-link", headers=_auth(ta)
        )
        assert resp.status_code == 403

    async def test_unauthenticated_cannot_generate_a_link(self, test_client, ta):
        resp = await test_client.post(f"/api/v1/users/{ta.id}/setup-link")
        assert resp.status_code == 401

    async def test_unknown_user_is_404(self, test_client, admin):
        resp = await test_client.post(
            f"/api/v1/users/{uuid.uuid4()}/setup-link", headers=_auth(admin)
        )
        assert resp.status_code == 404

    async def test_reset_password_endpoint_is_gone(
        self, test_client, admin, instructor
    ):
        """Replaced by setup-link: admins no longer choose other people's
        passwords."""
        resp = await test_client.post(
            f"/api/v1/users/{instructor.id}/reset-password",
            json={"new_password": "admin-chosen"},
            headers=_auth(admin),
        )
        assert resp.status_code == 404


class TestTokenLifecycle:
    async def test_deleting_a_user_deletes_their_tokens(
        self, test_client, db_session, admin, instructor
    ):
        await issue_setup_token(db_session, instructor)
        await db_session.flush()

        resp = await test_client.delete(
            f"/api/v1/users/{instructor.id}", headers=_auth(admin)
        )
        assert resp.status_code == 204

        rows = (
            (
                await db_session.execute(
                    select(AccountSetupToken).where(
                        AccountSetupToken.user_id == instructor.id
                    )
                )
            )
            .scalars()
            .all()
        )
        assert rows == []

    async def test_tokens_are_scoped_to_one_user(
        self, test_client, db_session, pending_user, instructor
    ):
        """One user's link must never set another user's password."""
        raw, _ = await issue_setup_token(db_session, pending_user)
        await test_client.post(
            COMPLETE, json={"token": raw, "new_password": "chosen-password"}
        )
        await db_session.refresh(instructor)
        assert bcrypt.verify("secret", instructor.password_hash)
