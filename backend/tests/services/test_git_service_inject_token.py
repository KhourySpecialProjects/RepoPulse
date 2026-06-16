"""Tests for GitService._inject_token — especially the stale-credential stripping fix."""
from __future__ import annotations

import pytest

from app.services.git_service import GitService


@pytest.mark.parametrize(
    "url, token, expected",
    [
        # Normal case: bare URL + token → credentials injected
        (
            "https://github.com/org/repo",
            "mytoken",
            "https://x-access-token:mytoken@github.com/org/repo",
        ),
        # Stale token in URL (from a previous clone/fetch) → stripped and replaced
        (
            "https://x-access-token:oldtoken@github.com/org/repo",
            "newtoken",
            "https://x-access-token:newtoken@github.com/org/repo",
        ),
        # No token provided → URL returned unchanged
        (
            "https://github.com/org/repo",
            None,
            "https://github.com/org/repo",
        ),
        # No token + stale URL → URL returned unchanged
        (
            "https://x-access-token:oldtoken@github.com/org/repo",
            None,
            "https://x-access-token:oldtoken@github.com/org/repo",
        ),
        # Non-GitHub URL → URL returned unchanged even with a token
        (
            "https://gitlab.com/org/repo",
            "mytoken",
            "https://gitlab.com/org/repo",
        ),
        # SSH URL → unchanged
        (
            "git@github.com:org/repo.git",
            "mytoken",
            "git@github.com:org/repo.git",
        ),
    ],
)
def test_inject_token(url: str, token: str | None, expected: str) -> None:
    assert GitService._inject_token(url, token) == expected
