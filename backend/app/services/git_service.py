from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import git

logger = logging.getLogger(__name__)


class GitService:
    """Single point of contact for all git operations via GitPython."""

    @staticmethod
    def _inject_token(url: str, token: str | None = None) -> str:
        """Embed a GitHub token into an HTTPS GitHub URL if provided."""
        if not token:
            return url
        # Strip any previously embedded credentials (e.g. from a prior clone/fetch)
        # so a stale token in .git/config doesn't block fresh authentication.
        if "@github.com/" in url:
            url = "https://github.com/" + url.split("@github.com/", 1)[1]
        if not url.startswith("https://github.com/"):
            return url
        return url.replace("https://", f"https://x-access-token:{token}@", 1)

    async def clone_repo(self, github_url: str, local_path: str, token: str | None = None) -> None:
        """Full clone of the repository (not shallow)."""
        await asyncio.to_thread(self._clone_repo_sync, github_url, local_path, token)

    def _clone_repo_sync(self, github_url: str, local_path: str, token: str | None = None) -> None:
        t0 = time.perf_counter()
        logger.info("git clone %s → %s", github_url, local_path)
        path = Path(local_path)
        path.mkdir(parents=True, exist_ok=True)
        git.Repo.clone_from(self._inject_token(github_url, token), str(path))
        logger.info("git clone complete in %.2fs: %s", time.perf_counter() - t0, local_path)

    async def fetch_repo(self, local_path: str, token: str | None = None) -> None:
        """Fetch all remotes."""
        await asyncio.to_thread(self._fetch_repo_sync, local_path, token)

    def _fetch_repo_sync(self, local_path: str, token: str | None = None) -> None:
        t0 = time.perf_counter()
        repo = git.Repo(local_path)
        # Update remote URL to include token in case it changed or was cloned without one
        logger.info("git fetch %s", local_path)
        for remote in repo.remotes:
            remote.set_url(self._inject_token(remote.url, token))
            remote.fetch()
            logger.info("git fetch complete: %s/%s", local_path, remote.name)
        logger.debug("git fetch total: %.2fs — %s", time.perf_counter() - t0, local_path)

    async def parse_commits(self, local_path: str) -> list[dict[str, Any]]:
        """Parse all commits across all branches.

        Returns a list of dicts with keys:
            hash, author_name, author_email, date, message,
            branch, insertions, deletions, files_changed
        """
        return await asyncio.to_thread(self._parse_commits_sync, local_path)

    @staticmethod
    def _all_refs(repo: git.Repo) -> list[Any]:
        """Return all local branches + remote-tracking refs, excluding HEAD pointers."""
        refs: list[Any] = list(repo.branches)
        for remote in repo.remotes:
            for ref in remote.refs:
                # Skip origin/HEAD — it's a symbolic pointer, not a real branch
                if not ref.name.endswith("/HEAD"):
                    refs.append(ref)
        return refs

    @staticmethod
    def _ref_display_name(ref: Any) -> str:
        """Strip remote prefix from a ref name (e.g. 'origin/main' → 'main')."""
        if isinstance(ref, git.RemoteReference):
            return ref.name[len(ref.remote_name) + 1:]
        return ref.name

    def _parse_commits_sync(self, local_path: str) -> list[dict[str, Any]]:
        t0 = time.perf_counter()
        repo = git.Repo(local_path)

        # First pass: map each commit hash → set of branch names (local + remote)
        hash_to_branches: dict[str, set[str]] = {}
        hash_to_commit: dict[str, Any] = {}

        for ref in self._all_refs(repo):
            branch_name = self._ref_display_name(ref)
            for commit in repo.iter_commits(ref):
                h = commit.hexsha
                if h not in hash_to_branches:
                    hash_to_branches[h] = set()
                    hash_to_commit[h] = commit
                hash_to_branches[h].add(branch_name)

        logger.debug(
            "parse_commits: found %d unique commits across %d refs in %.2fs (first pass) — %s",
            len(hash_to_commit), len(list(self._all_refs(repo))), time.perf_counter() - t0, local_path,
        )

        # Second pass: build commit records
        commits: list[dict[str, Any]] = []
        for h, commit in hash_to_commit.items():
            try:
                stats = commit.stats.total
                insertions = stats.get("insertions", 0)
                deletions = stats.get("deletions", 0)
                files_changed = stats.get("files", 0)
            except Exception:
                insertions = deletions = files_changed = 0

            committed_dt = commit.committed_datetime
            if committed_dt.tzinfo is None:
                committed_dt = committed_dt.replace(tzinfo=timezone.utc)

            # Sort branch names; put main/master first
            branches = sorted(
                hash_to_branches[h],
                key=lambda b: (b not in ("main", "master"), b),
            )

            commits.append({
                "hash": h,
                "author_name": commit.author.name or "",
                "author_email": commit.author.email or "",
                "date": committed_dt,
                "message": commit.message.strip(),
                "branches": branches,
                "insertions": insertions,
                "deletions": deletions,
                "files_changed": files_changed,
            })

        commits.sort(key=lambda c: c["date"], reverse=True)
        elapsed = time.perf_counter() - t0
        logger.debug("parse_commits: built %d commit records in %.2fs total — %s", len(commits), elapsed, local_path)
        return commits

    async def get_active_branches(self, local_path: str) -> list[str]:
        """Return deduplicated branch names across local and remote refs."""
        return await asyncio.to_thread(self._get_active_branches_sync, local_path)

    def _get_active_branches_sync(self, local_path: str) -> list[str]:
        repo = git.Repo(local_path)
        seen: set[str] = set()
        branches: list[str] = []
        for ref in self._all_refs(repo):
            name = self._ref_display_name(ref)
            if name not in seen:
                seen.add(name)
                branches.append(name)
        return sorted(branches)

    async def get_recent_commits(self, local_path: str, limit: int = 15) -> list[dict[str, Any]]:
        """Get recent commits and the evidence needed for quality evaluation."""
        return await asyncio.to_thread(self._get_recent_commits_sync, local_path, limit)

    def _get_recent_commits_sync(self, local_path: str, limit: int = 15) -> list[dict[str, Any]]:
        repo = git.Repo(local_path)
        # After `git fetch`, the remote tracking branch (e.g. origin/main) is ahead
        # of the local HEAD if no merge/pull was done. Prefer the tracking ref so
        # Re-analyze reflects newly fetched commits without needing a full sync.
        start_ref = None
        try:
            tracking = repo.active_branch.tracking_branch()
            if tracking:
                start_ref = tracking
        except (TypeError, ValueError):
            pass  # detached HEAD — fall back to default (HEAD)
        commits = []
        branch_name = self._ref_display_name(start_ref) if start_ref is not None else "HEAD"
        for commit in repo.iter_commits(start_ref, max_count=limit):
            try:
                stats = commit.stats.total
                insertions = stats.get("insertions", 0)
                deletions = stats.get("deletions", 0)
                files_changed = stats.get("files", 0)
                changed_files = list(commit.stats.files.keys())
            except Exception:
                insertions = deletions = files_changed = 0
                changed_files = []

            try:
                parent = commit.parents[0] if commit.parents else git.NULL_TREE
                diff_parts = commit.diff(parent, create_patch=True)
                diff = "\n".join(
                    part.diff.decode("utf-8", errors="replace")
                    if isinstance(part.diff, bytes)
                    else str(part.diff)
                    for part in diff_parts
                )
            except Exception:
                diff = ""

            commits.append({
                "hash": commit.hexsha[:7],
                "full_hash": commit.hexsha,
                "message": commit.message.strip().split("\n")[0],  # subject line only
                "commit_message": commit.message.strip(),
                "author": commit.author.name,
                "date": commit.authored_datetime.isoformat(),
                "branch": branch_name,
                "branches": [branch_name],
                "files_changed": files_changed,
                "insertions": insertions,
                "deletions": deletions,
                "total_lines_changed": insertions + deletions,
                "changed_files": changed_files,
                "diff": diff,
            })
        return commits

    async def get_contributors(self, local_path: str) -> list[dict[str, str]]:
        """Return unique (email, name) pairs from all commits across all refs."""
        return await asyncio.to_thread(self._get_contributors_sync, local_path)

    def _get_contributors_sync(self, local_path: str) -> list[dict[str, str]]:
        repo = git.Repo(local_path)
        seen: set[tuple[str, str]] = set()
        contributors: list[dict[str, str]] = []

        for ref in self._all_refs(repo):
            for commit in repo.iter_commits(ref):
                email = (commit.author.email or "").lower()
                name = commit.author.name or ""
                key = (email, name)
                if key not in seen:
                    seen.add(key)
                    contributors.append({"email": email, "name": name})

        return contributors
