from __future__ import annotations

import logging
import os
import sys

from fastapi import FastAPI, Request, Response, status

# Uvicorn's default log config sets root to WARNING, so app.* loggers need
# their own handler to emit INFO messages.
# Set APP_LOG_LEVEL=DEBUG in the environment to enable debug-level timing logs.
_log_level = logging.DEBUG if os.getenv("APP_LOG_LEVEL", "INFO").upper() == "DEBUG" else logging.INFO
_app_logger = logging.getLogger("app")
_app_logger.setLevel(_log_level)
if not _app_logger.handlers:
    _handler = logging.StreamHandler(sys.stdout)
    _handler.setFormatter(logging.Formatter("%(levelname)s:%(name)s:%(message)s"))
    _app_logger.addHandler(_handler)
    _app_logger.propagate = False  # prevent double-logging through root

# ---------------------------------------------------------------------------
# OpenTelemetry tracing (opt-in via OTEL_EXPORTER_OTLP_ENDPOINT env var)
# ---------------------------------------------------------------------------


def _init_tracing() -> None:
    endpoint = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT")
    if not endpoint:
        return

    from opentelemetry import trace
    from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
    from opentelemetry.sdk.resources import SERVICE_NAME, Resource
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import SimpleSpanProcessor
    from openinference.instrumentation.anthropic import AnthropicInstrumentor

    provider = TracerProvider(
        resource=Resource(attributes={SERVICE_NAME: "repopulse-backend"})
    )
    traces_endpoint = endpoint.rstrip("/") + "/v1/traces"
    exporter = OTLPSpanExporter(endpoint=traces_endpoint)
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    trace.set_tracer_provider(provider)
    AnthropicInstrumentor().instrument(tracer_provider=provider)
    _app_logger.info("OpenTelemetry tracing → %s", traces_endpoint)


_init_tracing()

from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from sqlalchemy import text

from app.api.routes import api_router
from app.db.database import engine
from app.services.contributor_service import ContributorOperationError
from app.schemas.errors import ErrorResponse
from app.schemas.meta import HealthzResponse

app = FastAPI(
    title="RepoPulse API",
    version="1.0.0",
    description="Monitor student GitHub repositories with health dashboards and AI summaries.",
)

# ---------------------------------------------------------------------------
# CORS
# ---------------------------------------------------------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://frontend:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Exception handlers
# ---------------------------------------------------------------------------


@app.exception_handler(ContributorOperationError)
async def contributor_operation_error_handler(request: Request, exc: ContributorOperationError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content=ErrorResponse(detail=exc.detail, error_code=exc.error_code).model_dump(),
    )


@app.exception_handler(404)
async def not_found_handler(request: Request, exc: Exception) -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_404_NOT_FOUND,
        content={"detail": "Resource not found", "error_code": "NOT_FOUND"},
    )


@app.exception_handler(500)
async def internal_error_handler(request: Request, exc: Exception) -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "detail": "An internal server error occurred",
            "error_code": "INTERNAL_SERVER_ERROR",
        },
    )


# ---------------------------------------------------------------------------
# Schema
# ---------------------------------------------------------------------------
#
# There is deliberately no startup hook here. This app used to call
# Base.metadata.create_all on every boot, which built the schema from the
# models and meant the Alembic chain was never exercised — it had been broken
# for nineteen revisions before anyone noticed, because every local
# environment kept working. Alembic is now the only thing that creates tables;
# backend/entrypoint.sh runs `alembic upgrade head` before this process starts.


# ---------------------------------------------------------------------------
# Routers — all under /api/v1
# ---------------------------------------------------------------------------

app.include_router(api_router, prefix="/api/v1")


# ---------------------------------------------------------------------------
# Health check (no auth)
# ---------------------------------------------------------------------------


@app.get("/healthz", tags=["meta"], response_model=HealthzResponse)
async def healthz(response: Response) -> HealthzResponse:
    """Report whether this process can actually serve requests.

    The database is probed rather than assumed. With `create_all` gone, a
    container whose migrations never ran now looks perfectly healthy until the
    first real request 500s — this endpoint is what makes that state visible,
    and what lets a compose healthcheck catch it.
    """
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
            # to_regclass rather than querying alembic_version directly: a
            # missing table would raise, abort the transaction, and get
            # reported as "unreachable" when the database is in fact fine.
            table = (
                await conn.execute(text("SELECT to_regclass('public.alembic_version')"))
            ).scalar()
            revision = None
            if table is not None:
                revision = (
                    await conn.execute(text("SELECT version_num FROM alembic_version"))
                ).scalar_one_or_none()
    except Exception as exc:  # noqa: BLE001 — any failure here means unhealthy
        _app_logger.warning("healthz: database probe failed: %s", exc)
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return HealthzResponse(
            status="error",
            database="unreachable",
            detail="Database is unreachable.",
        )

    if revision is None:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return HealthzResponse(
            status="error",
            database="ok",
            detail="Schema is not migrated — run `alembic upgrade head`.",
        )

    return HealthzResponse(status="ok", database="ok", schema_revision=revision)
