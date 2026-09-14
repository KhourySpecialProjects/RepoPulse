from __future__ import annotations

import os
import subprocess
import uuid
from pathlib import Path
from typing import AsyncGenerator
from unittest.mock import AsyncMock

import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    create_async_engine,
)
from sqlalchemy.pool import NullPool

from app.core.auth import create_access_token
from app.core.config import settings
from app.core.deps import get_db_session
from app.main import app
from app.models.user import User
from app.services.llm.base import LLMService

BACKEND_ROOT = Path(__file__).resolve().parents[1]

# ---------------------------------------------------------------------------
# Database engine & tables
# ---------------------------------------------------------------------------
#
# asyncpg Connection objects are bound to the event loop that created them.
# Handing a pooled connection to a different loop leaves it in a split-brain
# state — in a transaction at the protocol level, but unknown to asyncpg's own
# bookkeeping — and the next BEGIN fails with:
#
#     InterfaceError: cannot use Connection.transaction() in a manually
#                     started transaction
#
# Two rules keep that from happening:
#   1. Schema setup owns a short-lived engine that is disposed before yielding,
#      so no connection escapes the session-scoped loop.
#   2. Every per-test engine uses NullPool, so connections are opened and
#      closed inside the test's own loop and never reused across loops.


async def _reset_public_schema() -> None:
    """Drop everything in the test database, types included.

    `DROP SCHEMA public CASCADE` rather than `Base.metadata.drop_all` because
    the schema is Alembic's to build: drop_all only knows about tables the
    models declare, and would leave behind the enum types the models mark
    `create_type=False` (notification_type, collection_role) along with
    alembic_version. A stale enum is the worst of those — it survives, so a
    migration that adds a value appears to work while the old type is still in
    place.
    """
    engine = create_async_engine(settings.TEST_DATABASE_URL, poolclass=NullPool)
    async with engine.begin() as conn:
        await conn.execute(text("DROP SCHEMA public CASCADE"))
        await conn.execute(text("CREATE SCHEMA public"))
    await engine.dispose()


@pytest_asyncio.fixture(scope="session", loop_scope="session")
async def _database_schema() -> AsyncGenerator[None, None]:
    """Build the schema once per run, leaking no connections into test loops.

    The schema comes from `alembic upgrade head`, not `create_all`: migrations
    are the single source of truth, so the suite runs against the same DDL a
    real deployment gets. `tests/test_migrations.py` separately guards that the
    chain and the models agree.

    Alembic runs in a subprocess with DATABASE_URL pointed at the test database
    — `app/db/migrations/env.py` reads `settings.DATABASE_URL` unconditionally
    and calls `asyncio.run()` at import, which cannot happen inside this
    already-running loop. Same reasoning as `tests/test_migrations.py`.
    """
    import app.models  # noqa: F401 — ensure all models are registered

    await _reset_public_schema()

    result = subprocess.run(
        ["alembic", "upgrade", "head"],
        cwd=BACKEND_ROOT,
        env={**os.environ, "DATABASE_URL": settings.TEST_DATABASE_URL},
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(
            "alembic upgrade head failed while building the test schema.\n\n"
            f"stdout:\n{result.stdout}\n\nstderr:\n{result.stderr}"
        )

    yield

    await _reset_public_schema()


@pytest_asyncio.fixture
async def test_engine(_database_schema: None) -> AsyncGenerator[AsyncEngine, None]:
    """Per-test engine whose connections live and die in this test's loop."""
    engine = create_async_engine(
        settings.TEST_DATABASE_URL, echo=False, poolclass=NullPool
    )
    yield engine
    await engine.dispose()


# ---------------------------------------------------------------------------
# DB session (per test, rolled back)
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def db_session(test_engine: AsyncEngine) -> AsyncGenerator[AsyncSession, None]:
    """Provide an async session whose writes never outlive the test.

    Owns an explicit connection-level transaction and let the session
    join it as a SAVEPOINT (`join_transaction_mode="create_savepoint"`). A
    route's commit then only releases its savepoint; rolling back the outer
    transaction at teardown discards everything.
    """
    async with test_engine.connect() as conn:
        outer = await conn.begin()

        session = AsyncSession(
            bind=conn,
            expire_on_commit=False,
            join_transaction_mode="create_savepoint",
        )

        try:
            yield session
        finally:
            await session.close()
            if outer.is_active:
                await outer.rollback()


# ---------------------------------------------------------------------------
# Test client (per test)
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def test_client(db_session: AsyncSession) -> AsyncGenerator[AsyncClient, None]:
    """AsyncClient wired to the FastAPI app with the test DB session injected."""

    async def override_get_db_session():
        yield db_session

    app.dependency_overrides[get_db_session] = override_get_db_session

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        yield client

    app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# Test user & auth headers
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def test_user(db_session: AsyncSession) -> User:
    """Create and persist a test user."""
    user = User(
        id=uuid.uuid4(),
        email="test@example.com",
        display_name="Test User",
        role="instructor",
        password_hash=None,
        # Repo-creation and PR-sync endpoints gate on a configured token
        # (repos.py add_repos, pull_requests.py sync). Without it those return
        # 403 before reaching the behaviour under test.
        github_token="ghp_testtoken",
    )
    db_session.add(user)
    await db_session.flush()
    return user


@pytest.fixture
def auth_headers(test_user: User) -> dict[str, str]:
    """Return Authorization header dict for the test user."""
    token = create_access_token({"sub": str(test_user.id)})
    return {"Authorization": f"Bearer {token}"}


@pytest_asyncio.fixture
async def admin_user(db_session: AsyncSession) -> User:
    """An instance administrator, as distinct from test_user's "instructor".

    Three modules already define an equivalent fixture locally
    (test_users.py, test_collections_rbac.py, test_collection_access.py).
    pytest resolves fixtures closest-first, so those shadow this one and are
    unaffected by its existence.

    Note for count assertions: requesting this fixture inserts a row into
    `users`. A test asserting an empty instance must request neither this nor
    test_user.
    """
    user = User(
        id=uuid.uuid4(),
        email="admin@example.com",
        display_name="Admin User",
        role="admin",
        password_hash=None,
        github_token="ghp_admintoken",
    )
    db_session.add(user)
    await db_session.flush()
    return user


@pytest.fixture
def admin_auth_headers(admin_user: User) -> dict[str, str]:
    """Return Authorization header dict for the admin user."""
    token = create_access_token({"sub": str(admin_user.id)})
    return {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------------------
# Background repo indexing
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def no_background_indexing(monkeypatch: pytest.MonkeyPatch) -> None:
    """Neutralise the background indexing tasks that repo routes schedule.

    Two reasons these cannot run under test:

    1. They git-clone over the network. add_repos schedules _clone_and_index
       with force_clone=True, which would fetch the real GitHub URL.
    2. _index_repo deliberately bypasses the injected session and opens its own
       via the app's global async_session_maker. That engine pools connections
       across tests, and asyncpg connections are bound to their creating event
       loop — reusing one from another test's loop raises
       "cannot perform operation: another operation is in progress".

    No test asserts on indexing side effects; the ones that care about health
    or sync state construct Repo rows directly.
    """

    async def _noop(*args: object, **kwargs: object) -> None:
        return None

    monkeypatch.setattr("app.api.routes.repos._clone_and_index", _noop)
    monkeypatch.setattr("app.api.routes.repos._fetch_and_recompute", _noop)
    monkeypatch.setattr("app.api.routes.collections._sync_all_repos", _noop)


# ---------------------------------------------------------------------------
# Mock LLM service
# ---------------------------------------------------------------------------


@pytest.fixture
def mock_llm() -> LLMService:
    """Return a mock LLMService that always returns a fixed string."""

    class MockLLMService(LLMService):
        async def generate(
            self,
            prompt: str,
            system: str | None = None,
            max_tokens: int = 1024,
        ) -> str:
            return "This is a mock LLM response."

    return MockLLMService()
