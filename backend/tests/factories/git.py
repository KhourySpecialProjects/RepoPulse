"""Test doubles for the filesystem boundary.

AdminStatsService takes a GitService so storage tests never walk a real
/repos mount. That matters more than convenience: the autouse
`no_background_indexing` fixture neutralises three *named* functions, so
anything reaching the real filesystem or the global session maker from a new
code path would not be caught by it.
"""

from __future__ import annotations


class FakeGitService:
    """Stands in for GitService wherever only sizes and layout are needed.

    Records calls so tests can assert on what was *not* walked — the default
    storage view must not size orphan directories.
    """

    def __init__(
        self,
        sizes: dict[str, dict[str, int]] | None = None,
        directories: list[str] | None = None,
    ) -> None:
        # Absent from `sizes` means "no clone there": get_repo_size returns
        # None, matching the real service's contract.
        self.sizes = sizes or {}
        self.directories = directories or []
        self.size_calls: list[str] = []
        self.list_calls: int = 0

    async def get_repo_size(self, local_path: str) -> dict[str, int] | None:
        self.size_calls.append(local_path)
        return self.sizes.get(local_path)

    async def list_clone_directories(self, root: str | None = None) -> list[str]:
        self.list_calls += 1
        return sorted(self.directories)

    @staticmethod
    def clone_path(collection_folder_name: str, repo_name: str) -> str:
        return f"/repos/{collection_folder_name}/{repo_name}"
