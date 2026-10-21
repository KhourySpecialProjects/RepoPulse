"""Tests for backend/entrypoint.sh.

The entrypoint runs before anything else in the container, so when it fails the
API never comes up and every page of the frontend sits on a loading state.
These run the real script with stub `infisical`, `alembic` and `uvicorn`
executables first on PATH, each of which appends how it was called to a log.

Infisical is opt-in: with its three credentials set (the deployed server), the
migrations and the server run under `infisical run` so they receive its
secrets; with none set (every local checkout), they run directly against the
environment from .env. Requiring Infisical unconditionally is what stopped the
backend from starting anywhere without those credentials.
"""
from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

import pytest

ENTRYPOINT = Path(__file__).resolve().parents[1] / "entrypoint.sh"

pytestmark = pytest.mark.skipif(shutil.which("sh") is None, reason="needs a POSIX sh")

STUBS = {
    "infisical": """#!/bin/sh
echo "infisical $* token=${INFISICAL_TOKEN:-}" >> "$LOG"
case "$1" in
  login)
    [ -n "$FAIL_LOGIN" ] && exit 1
    echo "tok-123"
    ;;
  run)
    while [ "$1" != "--" ]; do shift; done
    shift
    exec "$@"
    ;;
esac
""",
    "alembic": """#!/bin/sh
echo "alembic $*" >> "$LOG"
if [ "$1" = "current" ]; then echo "0014 (head)"; fi
""",
    "uvicorn": """#!/bin/sh
echo "uvicorn $*" >> "$LOG"
""",
}

CREDENTIALS = {
    "INFISICAL_CLIENT_ID": "cid",
    "INFISICAL_CLIENT_SECRET": "csecret",
    "INFISICAL_PROJECT_ID": "pid",
}


def _run(tmp_path: Path, args: list[str], **env: str) -> tuple[subprocess.CompletedProcess, list[str]]:
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir(exist_ok=True)
    for name, body in STUBS.items():
        stub = bin_dir / name
        stub.write_text(body)
        stub.chmod(0o755)
    log = tmp_path / "calls.log"
    log.touch()

    result = subprocess.run(
        ["sh", str(ENTRYPOINT), *args],
        # Built from scratch, not os.environ: a real INFISICAL_* in the test
        # container must not leak in and change which branch runs.
        env={"PATH": f"{bin_dir}:{os.environ['PATH']}", "HOME": str(tmp_path), "LOG": str(log), **env},
        capture_output=True,
        text=True,
        timeout=30,
    )
    return result, log.read_text().splitlines()


class TestWithoutInfisical:
    def test_server_start_migrates_then_runs_uvicorn_directly(self, tmp_path):
        result, calls = _run(tmp_path, ["uvicorn", "app.main:app"])

        assert result.returncode == 0, result.stderr
        assert calls == ["alembic upgrade head", "alembic current", "uvicorn app.main:app"]

    def test_one_off_command_runs_directly_without_migrating(self, tmp_path):
        result, calls = _run(tmp_path, ["echo", "hello"])

        assert result.returncode == 0, result.stderr
        assert result.stdout.strip() == "hello"
        assert calls == []

    def test_partial_credentials_are_an_error(self, tmp_path):
        # Half a configuration is a mistake on a server, not a request to skip
        # Infisical — running without the secrets would fail later, less clearly.
        result, calls = _run(
            tmp_path, ["uvicorn", "app.main:app"], INFISICAL_CLIENT_ID="cid"
        )

        assert result.returncode != 0
        assert "INFISICAL_CLIENT_SECRET" in result.stderr
        assert calls == []


class TestWithInfisical:
    def test_migrations_and_server_run_under_infisical(self, tmp_path):
        result, calls = _run(tmp_path, ["uvicorn", "app.main:app"], **CREDENTIALS)

        assert result.returncode == 0, result.stderr
        assert calls[0].startswith(
            "infisical login --method=universal-auth --client-id=cid --client-secret=csecret"
        )
        assert calls[1:] == [
            "infisical run --projectId=pid --env=prod -- alembic upgrade head token=tok-123",
            "alembic upgrade head",
            "infisical run --projectId=pid --env=prod -- alembic current token=tok-123",
            "alembic current",
            "infisical run --projectId=pid --env=prod -- uvicorn app.main:app token=tok-123",
            "uvicorn app.main:app",
        ]

    def test_environment_can_be_overridden(self, tmp_path):
        result, calls = _run(
            tmp_path, ["uvicorn", "app.main:app"], INFISICAL_ENV="staging", **CREDENTIALS
        )

        assert result.returncode == 0, result.stderr
        assert "infisical run --projectId=pid --env=staging -- alembic upgrade head token=tok-123" in calls

    def test_failed_login_stops_before_anything_runs(self, tmp_path):
        # Fail closed: a server that cannot fetch its secrets must not start.
        result, calls = _run(
            tmp_path, ["uvicorn", "app.main:app"], FAIL_LOGIN="1", **CREDENTIALS
        )

        assert result.returncode != 0
        assert [c for c in calls if not c.startswith("infisical login")] == []
