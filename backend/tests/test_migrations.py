"""The migration chain must build the schema, and must agree with the models.

Nothing else in this suite exercises Alembic. `tests/conftest.py` builds its
schema with `Base.metadata.create_all`, which is fast and convenient but means
the migrations are never run — that is how the chain came to be missing a
baseline entirely while every local environment kept working.

These tests close that gap. They run the real chain against a throwaway
database and diff the result against the models, so a migration that does not
apply from empty, or a model change that never got a migration, fails here.

The scratch database is separate from TEST_DATABASE_URL on purpose: the
session-scoped `_database_schema` fixture drops every table in that one.
"""
from __future__ import annotations

import os
import subprocess
from pathlib import Path
from typing import AsyncGenerator

import pytest_asyncio
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import Connection, text
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import NullPool

from app.core.config import settings
from app.db.database import Base

BACKEND_ROOT = Path(__file__).resolve().parents[1]
SCRATCH_DB = "repopulse_migration_test"


def _with_database(url: str, name: str) -> str:
    """Repoint a SQLAlchemy URL at a different database on the same server."""
    base, _, _ = url.rpartition("/")
    return f"{base}/{name}"


def _run_alembic(*args: str, database_url: str) -> subprocess.CompletedProcess[str]:
    """Invoke the alembic CLI against `database_url`.

    A subprocess rather than `alembic.command`, for two reasons:
    `app/db/migrations/env.py` reads `settings.DATABASE_URL` unconditionally and
    offers no override hook, and its `run_migrations_online()` calls
    `asyncio.run()` at import — which raises inside an already-running event
    loop. Passing DATABASE_URL in the environment sidesteps both: pydantic
    BaseSettings reads env vars, and they take precedence over `.env`.
    """
    return subprocess.run(
        ["alembic", *args],
        cwd=BACKEND_ROOT,
        env={**os.environ, "DATABASE_URL": database_url},
        capture_output=True,
        text=True,
    )


def _metadata_diff(connection: Connection) -> list:
    """Differences Alembic sees between the live schema and the models."""
    context = MigrationContext.configure(connection)
    return compare_metadata(context, Base.metadata)


@pytest_asyncio.fixture
async def empty_database() -> AsyncGenerator[str, None]:
    """Yield a URL for a freshly created, completely empty database.

    CREATE DATABASE cannot run inside a transaction, hence AUTOCOMMIT. Engines
    are short-lived and NullPool'd so no connection outlives this fixture — the
    same event-loop discipline conftest.py documents at length.
    """
    admin_url = _with_database(settings.DATABASE_URL, "postgres")
    scratch_url = _with_database(settings.DATABASE_URL, SCRATCH_DB)

    async def _recreate(drop_only: bool = False) -> None:
        engine = create_async_engine(
            admin_url, poolclass=NullPool, isolation_level="AUTOCOMMIT"
        )
        async with engine.connect() as conn:
            await conn.execute(text(f'DROP DATABASE IF EXISTS "{SCRATCH_DB}" WITH (FORCE)'))
            if not drop_only:
                await conn.execute(text(f'CREATE DATABASE "{SCRATCH_DB}"'))
        await engine.dispose()

    await _recreate()
    yield scratch_url
    await _recreate(drop_only=True)


async def test_migrations_apply_to_an_empty_database(empty_database: str) -> None:
    """`alembic upgrade head` must succeed with no pre-existing schema.

    This is what a fresh deployment does. It is not what local development did,
    because `create_all` had already built the tables.
    """
    result = _run_alembic("upgrade", "head", database_url=empty_database)

    assert result.returncode == 0, (
        "alembic upgrade head failed against an empty database.\n\n"
        f"stdout:\n{result.stdout}\n\nstderr:\n{result.stderr}"
    )


async def test_migrated_schema_matches_the_models(empty_database: str) -> None:
    """A migrated database and `Base.metadata` must describe the same schema.

    Catches both directions of drift: a model column with no migration, and a
    migration whose result the models do not describe. Note that Alembic does
    not diff server defaults or CHECK constraints on existing tables, so those
    are verified by review of the baseline rather than here.
    """
    upgrade = _run_alembic("upgrade", "head", database_url=empty_database)
    assert upgrade.returncode == 0, (
        f"alembic upgrade head failed.\n\nstderr:\n{upgrade.stderr}"
    )

    engine = create_async_engine(empty_database, poolclass=NullPool)
    async with engine.connect() as conn:
        diff = await conn.run_sync(_metadata_diff)
    await engine.dispose()

    assert diff == [], (
        "The migrated schema does not match the models. Each entry is a change "
        "Alembic would generate to bring the database in line:\n\n"
        + "\n".join(repr(entry) for entry in diff)
    )


def test_migration_chain_has_exactly_one_head() -> None:
    """Two heads means a branch merge left the chain forked.

    This repo has hit that repeatedly — see `b801c1b "fused all 3 branch
    migrations into working build"`. Cheap to check, no database needed.
    """
    config = Config(str(BACKEND_ROOT / "alembic.ini"))
    config.set_main_option(
        "script_location", str(BACKEND_ROOT / "app" / "db" / "migrations")
    )
    heads = ScriptDirectory.from_config(config).get_heads()

    assert len(heads) == 1, f"expected a single head, found {len(heads)}: {heads}"
