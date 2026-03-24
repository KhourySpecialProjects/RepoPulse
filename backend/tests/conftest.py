from __future__ import annotations

import asyncio
import uuid
from typing import AsyncGenerator
from unittest.mock import AsyncMock

import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.core.auth import create_access_token
from app.core.config import settings
from app.core.deps import get_db_session
from app.db.database import Base
from app.main import app
from app.models.user import User
from app.services.llm.base import LLMService

# ---------------------------------------------------------------------------
# Event loop
# ---------------------------------------------------------------------------


@pytest.fixture(scope="session")
def event_loop():
    """Session-scoped event loop for async tests."""
    policy = asyncio.get_event_loop_policy()
    loop = policy.new_event_loop()
    yield loop
    loop.close()


# ---------------------------------------------------------------------------
# Database engine & tables
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture(scope="session")
async def test_engine():
    """Create async engine for test DB and set up schema once per session."""
    import app.models  # noqa: F401 — ensure all models are registered

    engine = create_async_engine(settings.TEST_DATABASE_URL, echo=False)

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)

    yield engine

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)

    await engine.dispose()


# ---------------------------------------------------------------------------
# DB session (per test, rolled back)
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def db_session(test_engine) -> AsyncGenerator[AsyncSession, None]:
    """Provide a transactional async session that rolls back after each test."""
    session_factory = async_sessionmaker(test_engine, expire_on_commit=False)

    async with session_factory() as session:
        async with session.begin():
            yield session
            await session.rollback()


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
