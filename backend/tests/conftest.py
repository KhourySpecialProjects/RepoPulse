from __future__ import annotations

import uuid
from typing import AsyncGenerator
from unittest.mock import AsyncMock

import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    create_async_engine,
)
from sqlalchemy.pool import NullPool

from app.core.auth import create_access_token
from app.core.config import settings
from app.core.deps import get_db_session
from app.db.database import Base
from app.main import app
from app.models.user import User
from app.services.llm.base import LLMService

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


@pytest_asyncio.fixture(scope="session", loop_scope="session")
async def _database_schema() -> AsyncGenerator[None, None]:
    """Build the schema once per run, leaking no connections into test loops."""
    import app.models  # noqa: F401 — ensure all models are registered

    engine = create_async_engine(settings.TEST_DATABASE_URL, poolclass=NullPool)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    await engine.dispose()

    yield

    engine = create_async_engine(settings.TEST_DATABASE_URL, poolclass=NullPool)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


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
    )
    db_session.add(user)
    await db_session.flush()
    return user


@pytest.fixture
def auth_headers(test_user: User) -> dict[str, str]:
    """Return Authorization header dict for the test user."""
    token = create_access_token({"sub": str(test_user.id)})
    return {"Authorization": f"Bearer {token}"}


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
