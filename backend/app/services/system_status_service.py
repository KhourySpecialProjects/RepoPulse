"""The database/schema probe, shared by /healthz and /admin/system.

/healthz cannot simply move onto the admin router: it is mounted on the app
precisely so it needs no auth and no /api/v1 prefix, and it is the compose
healthcheck. But the two endpoints must not drift into disagreeing about
whether the schema is migrated, so the probe itself lives here and both call
it.

The executor is whatever runs SQL — both AsyncSession and AsyncConnection
accept text(). /healthz passes a connection from the global engine (bound to
DATABASE_URL, which is what a container healthcheck should test);
/admin/system passes the request-scoped session, so it honours
dependency_overrides and works under test.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

from sqlalchemy import text

logger = logging.getLogger(__name__)

# app/services/system_status_service.py -> backend/
BACKEND_ROOT = Path(__file__).resolve().parents[2]


@dataclass(frozen=True)
class SchemaProbe:
    reachable: bool
    revision: str | None = None


async def probe_schema(executor: Any) -> SchemaProbe:
    """Check the database answers, and read its Alembic revision.

    to_regclass rather than querying alembic_version directly: a missing
    table would raise, abort the transaction, and get misreported as an
    unreachable database when the database is in fact fine.
    """
    try:
        await executor.execute(text("SELECT 1"))
        table = (
            await executor.execute(text("SELECT to_regclass('public.alembic_version')"))
        ).scalar()
        revision = None
        if table is not None:
            revision = (
                await executor.execute(text("SELECT version_num FROM alembic_version"))
            ).scalar_one_or_none()
    except Exception as exc:  # noqa: BLE001 — any failure here means unhealthy
        logger.warning("schema probe failed: %s", exc)
        return SchemaProbe(reachable=False)

    return SchemaProbe(reachable=True, revision=revision)


@lru_cache(maxsize=1)
def head_revision() -> str | None:
    """The head revision according to the migration files. No database.

    None when the chain has forked into multiple heads, which is a real
    condition this repo has hit — test_migration_chain_has_exactly_one_head
    is the test that catches it.
    """
    try:
        from alembic.config import Config
        from alembic.script import ScriptDirectory

        config = Config(str(BACKEND_ROOT / "alembic.ini"))
        config.set_main_option(
            "script_location", str(BACKEND_ROOT / "app" / "db" / "migrations")
        )
        heads = ScriptDirectory.from_config(config).get_heads()
        return heads[0] if len(heads) == 1 else None
    except Exception as exc:  # noqa: BLE001 — diagnostics must never 500
        logger.warning("could not read the migration head: %s", exc)
        return None
