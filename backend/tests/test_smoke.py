"""
Smoke tests: verify all modules import cleanly and the FastAPI app starts up.
These tests require NO database and run instantly — they catch import errors
and FastAPI decorator-time validation failures (e.g. invalid status codes,
response model mismatches) before the server ever starts.

Run with: docker compose exec backend pytest tests/test_smoke.py -v
"""
from __future__ import annotations


def test_import_models() -> None:
    """All SQLAlchemy models import without error."""
    import app.models  # noqa: F401
    from app.models.user import User
    from app.models.collection import Collection
    from app.models.repo import Repo
    from app.models.contributor import Contributor
    from app.models.contributor_alias import ContributorAlias
    from app.models.note import Note
    from app.models.summary import Summary
    from app.models.app_settings import AppSettings
    assert User.__tablename__ == "users"
    assert Collection.__tablename__ == "collections"
    assert Repo.__tablename__ == "repos"
    assert Contributor.__tablename__ == "contributors"
    assert ContributorAlias.__tablename__ == "contributor_aliases"
    assert Note.__tablename__ == "notes"
    assert Summary.__tablename__ == "summaries"
    assert AppSettings.__tablename__ == "app_settings"


def test_import_schemas() -> None:
    """All Pydantic schemas import and instantiate without error."""
    from app.schemas.auth import DevLoginRequest, LoginRequest, TokenResponse
    from app.schemas.users import UserRead
    from app.schemas.collections import CollectionCreate, CollectionRead, CollectionUpdate, PaginatedCollections
    from app.schemas.repos import RepoRead, AddReposRequest, PaginatedRepos
    from app.schemas.contributors import ContributorRead, ContributorUpdate, AliasRead, MergeContributorsRequest
    from app.schemas.notes import NoteCreate, NoteRead, NoteUpdate, PaginatedNotes
    from app.schemas.summaries import GenerateSummaryRequest, SummaryRead
    from app.schemas.app_settings import AppSettingsRead, AppSettingsUpdate
    from app.schemas.health import HealthBreakdown
    from app.schemas.commits import CommitRead, PaginatedCommits
    from app.schemas.errors import ErrorResponse

    # Verify key schemas can be instantiated
    req = DevLoginRequest(user_id="00000000-0000-0000-0000-000000000001")
    assert req.user_id == "00000000-0000-0000-0000-000000000001"

    err = ErrorResponse(detail="test", error_code="TEST")
    assert err.detail == "test"


def test_import_services() -> None:
    """All service modules import without error."""
    from app.services.llm.base import LLMService
    from app.services.llm.anthropic_adapter import AnthropicAdapter
    from app.services.health_service import HealthService
    from app.services.git_service import GitService
    from app.services.summary_service import SummaryService
    assert issubclass(AnthropicAdapter, LLMService)
    hs = HealthService()
    assert hasattr(hs, "compute_health")
    gs = GitService()
    assert hasattr(gs, "clone_repo")


def test_import_routes() -> None:
    """All route modules import without error (catches decorator-time FastAPI failures)."""
    from app.api.routes import auth, collections, repos, contributors, notes, summaries, settings
    # Verify each module has a router
    assert hasattr(auth, "router")
    assert hasattr(collections, "router")
    assert hasattr(repos, "router")
    assert hasattr(contributors, "router")
    assert hasattr(notes, "router")
    assert hasattr(summaries, "router")
    assert hasattr(settings, "router")


def test_app_creates_successfully() -> None:
    """The FastAPI app can be imported and created without error.
    This catches any startup-time failures including route registration errors."""
    from app.main import app
    from fastapi import FastAPI
    assert isinstance(app, FastAPI)
    # Verify routes are registered
    route_paths = {r.path for r in app.routes}  # type: ignore[union-attr]
    assert "/api/v1/auth/login" in route_paths
    assert "/api/v1/collections" in route_paths
    assert "/healthz" in route_paths


def test_all_routes_have_valid_status_codes() -> None:
    """No route should use a status code that conflicts with FastAPI's body rules.
    204 No Content cannot have a response_model — this test would have caught
    the original 204 decorator bug."""
    from app.main import app
    from fastapi.routing import APIRoute

    disallowed_with_body = {204, 304}
    for route in app.routes:
        if not isinstance(route, APIRoute):
            continue
        if route.status_code in disallowed_with_body:
            assert route.response_model is None, (
                f"Route {route.path} uses status {route.status_code} "
                f"but has response_model={route.response_model}"
            )


def test_relationship_list_annotations() -> None:
    """Verify that one-to-many relationships have uselist=True.
    This catches the Mapped[list] vs Mapped[list['Model']] annotation bug
    where SQLAlchemy silently sets uselist=False."""
    from app.models.collection import Collection
    from app.models.repo import Repo
    from app.models.contributor import Contributor
    from sqlalchemy import inspect

    col_insp = inspect(Collection)
    assert col_insp.relationships["repos"].uselist is True, \
        "Collection.repos must be a list relationship (uselist=True)"

    repo_insp = inspect(Repo)
    assert repo_insp.relationships["contributors"].uselist is True, \
        "Repo.contributors must be a list relationship (uselist=True)"
    assert repo_insp.relationships["notes"].uselist is True, \
        "Repo.notes must be a list relationship (uselist=True)"

    contrib_insp = inspect(Contributor)
    assert contrib_insp.relationships["aliases"].uselist is True, \
        "Contributor.aliases must be a list relationship (uselist=True)"
