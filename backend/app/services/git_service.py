from __future__ import annotations

import asyncio
import logging
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import git

from app.core.config import settings

logger = logging.getLogger(__name__)

# How many changed-file paths to keep per commit. Paths feed the commit
# classifier's rules prefilter and its prompt; a handful is enough to tell
# docs-only from source work, and an uncapped list on a vendored-dependency
# commit would be thousands of entries wide.
_MAX_TRACKED_PATHS = 20

# Trunk names to try when a clone has no origin/HEAD to read the default branch
# from — a bare `git init` repo, or a remote that never set it.
_TRUNK_FALLBACKS = ("main", "master")


def _diffstat(commit: Any) -> dict[str, Any]:
    """Extract churn counts and changed-file paths from a commit.

    commit.stats runs a diff against the parent, so it is the expensive part of
    parsing — but it is computed once here and yields both the totals and the
    per-file breakdown. Reading .files after .total costs nothing extra.

    A commit whose diff cannot be read (corrupt object, unusual merge) degrades
    to zeros rather than aborting the parse of every other commit. That failure
    is reported as diffstat_available=False rather than left to be inferred:
    zeros are indistinguishable from a genuinely empty commit, and the commit
    classifier treats those two cases very differently.
    """
    try:
        stats = commit.stats
        total = stats.total
        all_paths = list(stats.files.keys())
        return {
            "insertions": total.get("insertions", 0),
            "deletions": total.get("deletions", 0),
            "files_changed": total.get("files", 0),
            "file_paths": all_paths[:_MAX_TRACKED_PATHS],
            "file_paths_truncated": len(all_paths) > _MAX_TRACKED_PATHS,
            "diffstat_available": True,
        }
    except Exception:
        return {
            "insertions": 0,
            "deletions": 0,
            "files_changed": 0,
            "file_paths": [],
            "file_paths_truncated": False,
            "diffstat_available": False,
        }


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

    # ------------------------------------------------------------------
    # Clone layout
    # ------------------------------------------------------------------

    @staticmethod
    def clone_path(collection_folder_name: str, repo_name: str) -> str:
        """Where a clone lives on disk. The one place this layout is spelled.

        Storage accounting and repo creation must not be able to disagree
        about where clones are; before this existed the layout was an inline
        f-string in the repos route. Path joining also collapses a trailing
        slash on REPO_ROOT_DIR, which the f-string turned into '/repos//x'.
        """
        return str(Path(settings.REPO_ROOT_DIR) / collection_folder_name / repo_name)

    async def list_clone_directories(self, root: str | None = None) -> list[str]:
        """Every {root}/{collection}/{repo} directory — exactly depth 2.

        Depth 2 is what clone_path writes, so anything shallower or deeper is
        not a clone. Used to reconcile disk against the database.
        """
        return await asyncio.to_thread(
            self._list_clone_directories_sync, root or settings.REPO_ROOT_DIR
        )

    def _list_clone_directories_sync(self, root: str) -> list[str]:
        found: list[str] = []
        try:
            with os.scandir(root) as collections:
                for collection in collections:
                    if not collection.is_dir(follow_symlinks=False):
                        continue
                    try:
                        with os.scandir(collection.path) as repos:
                            found.extend(
                                os.path.normpath(repo.path)
                                for repo in repos
                                if repo.is_dir(follow_symlinks=False)
                            )
                    except OSError:
                        continue
        except (FileNotFoundError, NotADirectoryError, PermissionError):
            # An unmounted or not-yet-created repo root is a deployment
            # state, not an error worth failing a dashboard over.
            return []
        return sorted(found)

    # ------------------------------------------------------------------
    # Size on disk
    # ------------------------------------------------------------------

    async def get_repo_size(self, local_path: str) -> dict[str, int] | None:
        """Bytes on disk for one clone: {'total', 'git', 'worktree'}.

        Returns None — not zero — when the path is absent or is not a
        directory. Zero must keep meaning "an empty clone", so that a repo
        that was never measured stays distinguishable from one measuring 0.

        Reports apparent size (st_size), not allocated blocks, so it reads
        lower than `du` on a small-file-heavy tree like .git/objects. It is
        the number a backup or a transfer would move.
        """
        return await asyncio.to_thread(self._get_repo_size_sync, local_path)

    def _get_repo_size_sync(self, local_path: str) -> dict[str, int] | None:
        root = Path(local_path)
        if not root.is_dir():
            return None
        total = self._dir_size_sync(root)
        # 0 when .git is absent, which is a directory that is not a clone.
        git_bytes = self._dir_size_sync(root / ".git")
        return {
            "total": total,
            "git": git_bytes,
            "worktree": max(total - git_bytes, 0),
        }

    @staticmethod
    def _dir_size_sync(path: Path) -> int:
        """Sum apparent file sizes under a directory.

        Iterative rather than recursive: .git/objects fans out into 256
        directories and packed trees nest arbitrarily, so an explicit stack
        avoids both the recursion limit and per-frame cost.

        Symlinks are skipped entirely — not followed (which would escape the
        tree, double-count, and can cycle) and not counted at link size. A
        clone containing a link to a 4 GB dataset must not report 4 GB.
        """
        total = 0
        stack = [str(path)]
        while stack:
            current = stack.pop()
            try:
                with os.scandir(current) as entries:
                    for entry in entries:
                        try:
                            if entry.is_symlink():
                                continue
                            if entry.is_dir(follow_symlinks=False):
                                stack.append(entry.path)
                            elif entry.is_file(follow_symlinks=False):
                                total += entry.stat(follow_symlinks=False).st_size
                        except OSError:
                            # A file vanishing mid-walk, or one entry we may
                            # not stat, is normal. Wider failures propagate.
                            continue
            except (FileNotFoundError, NotADirectoryError, PermissionError):
                continue
        return total

    # ------------------------------------------------------------------
    # Clone / fetch
    # ------------------------------------------------------------------

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
            hash, author_name, author_email, date, message, branches,
            origin_branch, insertions, deletions, files_changed,
            file_paths, file_paths_truncated

        `branches` is every branch containing the commit; `origin_branch` is the
        single branch the work was done on. Filter on the latter — see
        _attribute_origin_branches.
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

    @staticmethod
    def _detect_trunk(repo: git.Repo, ref_names: set[str]) -> str | None:
        """The clone's default branch, preferred over a hardcoded main/master.

        Read from origin/HEAD, which `git clone` sets to whatever the remote's
        default branch is. Repos that develop on something else — RepoPulse
        itself uses `devTesting`, with `main` far behind — would otherwise have
        nearly every commit attributed to a feature branch.
        """
        for remote in repo.remotes:
            try:
                target = repo.git.symbolic_ref(f"refs/remotes/{remote.name}/HEAD")
            except git.GitCommandError:
                continue  # origin/HEAD not set on this remote
            prefix = f"refs/remotes/{remote.name}/"
            if target.startswith(prefix):
                name = target[len(prefix):]
                if name in ref_names:
                    return name

        for candidate in _TRUNK_FALLBACKS:
            if candidate in ref_names:
                return candidate

        # Detached HEAD raises TypeError; an unborn branch raises ValueError.
        try:
            active = repo.active_branch.name
        except (TypeError, ValueError):
            return None
        return active if active in ref_names else None

    @staticmethod
    def _attribute_origin_branches(
        hash_to_branches: dict[str, set[str]], trunk: str | None
    ) -> dict[str, str]:
        """Map each commit hash → the one branch the work was done on.

        `hash_to_branches` answers "which branches contain this commit", which
        is every branch cut from it. The owning branch is the inverse: trunk
        owns its own commits, and every other branch owns `trunk..branch` — the
        commits unique to it.

        A branch cut from another non-trunk branch shares its commits, so both
        have them in `trunk..branch`. The tie-break is the smaller exclusive
        set, i.e. the more specific branch, with the name as a stable
        secondary key so attribution does not depend on dict ordering.
        """
        branch_to_hashes: dict[str, set[str]] = {}
        for commit_hash, names in hash_to_branches.items():
            for name in names:
                branch_to_hashes.setdefault(name, set()).add(commit_hash)

        trunk_hashes = branch_to_hashes.get(trunk, set()) if trunk else set()

        owners: dict[str, str] = {h: trunk for h in trunk_hashes} if trunk else {}

        exclusive = (
            (name, hashes - trunk_hashes)
            for name, hashes in branch_to_hashes.items()
            if name != trunk
        )
        for name, hashes in sorted(exclusive, key=lambda kv: (len(kv[1]), kv[0])):
            for commit_hash in hashes:
                owners.setdefault(commit_hash, name)

        return owners

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

        # Which branch was each commit actually made on? `hash_to_branches`
        # cannot answer that — see _attribute_origin_branches.
        ref_names = {self._ref_display_name(r) for r in self._all_refs(repo)}
        trunk = self._detect_trunk(repo, ref_names)
        origin_branch_by_hash = self._attribute_origin_branches(
            hash_to_branches, trunk
        )

        # Second pass: build commit records
        commits: list[dict[str, Any]] = []
        for h, commit in hash_to_commit.items():
            stats = _diffstat(commit)

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
                # Falls back to the containment list only if attribution somehow
                # missed the commit; every ref-reachable commit gets an owner.
                "origin_branch": origin_branch_by_hash.get(h)
                or (branches[0] if branches else ""),
                **stats,
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
        """Get the most recent commits from HEAD without full branch traversal.

        Returns a list of dicts with keys:
            hash (short), full_hash, message (subject only), author, date,
            insertions, deletions, files_changed,
            file_paths, file_paths_truncated
        """
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
        for commit in repo.iter_commits(start_ref, max_count=limit):
            commits.append({
                "hash": commit.hexsha[:7],
                "full_hash": commit.hexsha,
                "message": commit.message.strip().split("\n")[0],  # subject line only
                "author": commit.author.name,
                "date": commit.authored_datetime.isoformat(),
                # Diffstat feeds the commit classifier's prompt: "Update user
                # routes" reads very differently at +340/-12 across 9 files than
                # at +2/-1 across 1. Bounded by `limit`, so the diff cost is a
                # dozen commits, not the whole history.
                **_diffstat(commit),
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
