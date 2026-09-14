"""Helpers behind GET /repos/{id}/commits filtering."""
from __future__ import annotations

from datetime import datetime, timezone

import pytest

from app.api.routes.repos import _as_utc, _derive_repo_name


class TestAsUtc:
    def test_naive_datetime_becomes_utc_aware(self) -> None:
        """?date_from=2026-01-01 parses naive; comparing it against a tz-aware
        commit date raises TypeError, which surfaced as a 500."""
        result = _as_utc(datetime(2026, 1, 1))
        assert result is not None
        assert result.tzinfo is not None
        # Comparable against a tz-aware commit date without raising.
        assert result < datetime(2026, 3, 1, tzinfo=timezone.utc)

    def test_aware_datetime_is_left_alone(self) -> None:
        original = datetime(2026, 1, 1, tzinfo=timezone.utc)
        assert _as_utc(original) == original

    def test_none_passes_through(self) -> None:
        assert _as_utc(None) is None


class TestDeriveRepoName:
    @pytest.mark.parametrize(
        "url,expected",
        [
            ("https://github.com/student/project", "project"),
            ("https://github.com/student/project.git", "project"),
            ("https://github.com/student/project/", "project"),
        ],
    )
    def test_normal_urls(self, url: str, expected: str) -> None:
        assert _derive_repo_name(url) == expected

    @pytest.mark.parametrize("url", ["https://github.com/student/..", "https://github.com/a/."])
    def test_dot_segments_never_escape_the_clone_directory(self, url: str) -> None:
        """The result is the last path segment of the clone path."""
        assert _derive_repo_name(url) == "unknown"
