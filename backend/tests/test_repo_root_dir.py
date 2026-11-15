"""The clone root must be absolute, and there must be exactly one of it.

docker-compose bind-mounts the host's ./seed-repos to /repos in the backend
container. That mount is the only place a clone survives a rebuild.

`.env` had `REPO_ROOT_DIR=./seed-repos`. Relative, so it resolved against the
container's working directory (/app) and clones landed in /app/seed-repos —
the container's writable layer, never the mount. Everything looked fine until
the next `docker compose up --build`, which threw the layer away. The Repo rows
survived, so the cards still rendered, but GET /repos/{id}/commits re-parses
the clone on every request and the clone was gone. The only way back was to
hit Sync and re-clone, every single time.

Nothing failed loudly. A relative clone root must not be accepted.
"""
from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.core.config import Settings, settings


def test_configured_clone_root_is_absolute() -> None:
    assert settings.REPO_ROOT_DIR.startswith("/"), (
        "REPO_ROOT_DIR must be absolute. A relative path resolves against the "
        "container's working directory instead of the /repos bind mount, and "
        "clones are silently lost on the next rebuild."
    )


def test_relative_clone_root_is_rejected() -> None:
    with pytest.raises(ValidationError):
        Settings(REPO_ROOT_DIR="./seed-repos")
