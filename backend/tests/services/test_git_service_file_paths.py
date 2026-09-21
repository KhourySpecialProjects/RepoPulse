"""Tests for the changed-file paths and diffstat that GitService reports.

The commit classifier's rules prefilter needs to recognise docs-only and
lockfile-only commits. Counts alone cannot express that — "1 file changed"
is the same number whether the file is README.md or auth_service.py — so
parse_commits carries the paths themselves.
"""
from __future__ import annotations

from pathlib import Path

import git
import pytest

from app.services.git_service import _MAX_TRACKED_PATHS, GitService


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _init_repo(path: Path) -> git.Repo:
    """Create a git repo with an identity, so commits can be made offline."""
    repo = git.Repo.init(path)
    with repo.config_writer() as cw:
        cw.set_value("user", "name", "Test Author")
        cw.set_value("user", "email", "test@example.com")
    return repo


def _commit_files(repo: git.Repo, files: dict[str, str], message: str) -> None:
    """Write each path (creating parents) and commit them together."""
    root = Path(repo.working_tree_dir)
    for rel_path, content in files.items():
        target = root / rel_path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content)
    repo.index.add(list(files))
    repo.index.commit(message)


# ---------------------------------------------------------------------------
# parse_commits
# ---------------------------------------------------------------------------


async def test_parse_commits_reports_changed_file_paths(tmp_path: Path) -> None:
    """Paths come back repo-relative, so extension and filename rules can match."""
    repo = _init_repo(tmp_path)
    _commit_files(
        repo,
        {"README.md": "# docs\n", "src/app.py": "print('hi')\n"},
        "Add readme and entrypoint",
    )

    commits = await GitService().parse_commits(str(tmp_path))

    assert len(commits) == 1
    commit = commits[0]
    assert sorted(commit["file_paths"]) == ["README.md", "src/app.py"]
    assert commit["file_paths_truncated"] is False
    assert commit["diffstat_available"] is True
    # The counts the paths sit alongside are unchanged.
    assert commit["files_changed"] == 2


async def test_parse_commits_truncates_long_path_lists(tmp_path: Path) -> None:
    """A wide commit is capped, and says so.

    The flag is what keeps the prefilter honest: without it, a 40-file commit
    whose first 20 files happen to be .md would look docs-only and be labeled
    logistical on the strength of half its evidence.
    """
    repo = _init_repo(tmp_path)
    file_count = _MAX_TRACKED_PATHS + 10
    _commit_files(
        repo,
        {f"file_{i:02d}.py": f"x = {i}\n" for i in range(file_count)},
        "Add many files",
    )

    commits = await GitService().parse_commits(str(tmp_path))

    commit = commits[0]
    assert len(commit["file_paths"]) == _MAX_TRACKED_PATHS
    assert commit["file_paths_truncated"] is True
    # files_changed still reports the true total, not the capped one.
    assert commit["files_changed"] == file_count


async def test_parse_commits_returns_empty_paths_when_stats_fail(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A commit whose diff cannot be read degrades to zeros, not an exception."""
    repo = _init_repo(tmp_path)
    _commit_files(repo, {"src/app.py": "print('hi')\n"}, "Add entrypoint")

    class _RaisingStats:
        def __get__(self, instance: object, owner: type | None = None) -> None:
            raise ValueError("simulated stats failure")

    monkeypatch.setattr(git.objects.commit.Commit, "stats", _RaisingStats())

    commits = await GitService().parse_commits(str(tmp_path))

    commit = commits[0]
    assert commit["file_paths"] == []
    assert commit["file_paths_truncated"] is False
    assert commit["insertions"] == 0
    assert commit["deletions"] == 0
    assert commit["files_changed"] == 0
    # The zeros above are ignorance, not emptiness. The classifier's rules
    # prefilter needs to tell those apart — an empty commit is logistical by
    # definition, an unreadable one is simply unknown.
    assert commit["diffstat_available"] is False


# ---------------------------------------------------------------------------
# get_recent_commits
# ---------------------------------------------------------------------------


async def test_get_recent_commits_includes_diffstat(tmp_path: Path) -> None:
    """The collection-quality path feeds the same diffstat-aware prompt.

    Without this, every commit reaching that prompt would carry +0/-0 across 0
    files — the single strongest signal the classifier has, blanked out.
    """
    repo = _init_repo(tmp_path)
    _commit_files(repo, {"src/app.py": "a = 1\nb = 2\n"}, "Add two lines")

    commits = await GitService().get_recent_commits(str(tmp_path), limit=5)

    assert len(commits) == 1
    commit = commits[0]
    assert commit["insertions"] == 2
    assert commit["deletions"] == 0
    assert commit["files_changed"] == 1
    assert commit["file_paths"] == ["src/app.py"]
    assert commit["file_paths_truncated"] is False
    assert commit["diffstat_available"] is True
    # Existing keys still present — this endpoint's response depends on them.
    assert commit["message"] == "Add two lines"
    assert commit["author"] == "Test Author"
