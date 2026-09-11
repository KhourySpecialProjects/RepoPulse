from __future__ import annotations

import logging
import os
import sys

from fastapi import FastAPI, Request, status

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

from app.api.routes import api_router
from app.db.database import Base, engine
from app.services.contributor_service import ContributorOperationError
from app.schemas.errors import ErrorResponse

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
# Startup
# ---------------------------------------------------------------------------


@app.on_event("startup")
async def on_startup() -> None:
    """Create tables on startup (dev convenience; Alembic manages migrations)."""
    # Import all models so Base.metadata is populated
    import app.models  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


# ---------------------------------------------------------------------------
# Routers — all under /api/v1
# ---------------------------------------------------------------------------

app.include_router(api_router, prefix="/api/v1")


# ---------------------------------------------------------------------------
# Health check (no auth)
# ---------------------------------------------------------------------------


@app.get("/healthz", tags=["meta"])
async def healthz() -> dict:
    return {"status": "ok"}
