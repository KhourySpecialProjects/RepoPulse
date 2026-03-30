from __future__ import annotations

from datetime import datetime, timezone

import httpx


class GitHubService:
    BASE_URL = "https://api.github.com"

    def _parse_github_url(self, url: str) -> tuple[str, str]:
        """Extract (owner, repo) from https://github.com/owner/repo[.git]"""
        url = url.rstrip("/").removesuffix(".git")
        parts = url.split("/")
        return parts[-2], parts[-1]

    async def fetch_pull_requests(self, github_url: str, token: str) -> list[dict]:
        """Fetch all PRs (open + closed) from GitHub API. Returns raw GitHub PR dicts."""
        owner, repo = self._parse_github_url(github_url)
        headers = {
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        }
        prs: list[dict] = []
        page = 1
        async with httpx.AsyncClient(timeout=30.0) as client:
            while True:
                resp = await client.get(
                    f"{self.BASE_URL}/repos/{owner}/{repo}/pulls",
                    params={"state": "all", "per_page": 100, "page": page},
                    headers=headers,
                )
                resp.raise_for_status()
                data = resp.json()
                if not data:
                    break
                prs.extend(data)
                page += 1
        return prs

    def parse_pr(self, raw: dict) -> dict:
        """Convert raw GitHub PR dict to our schema."""
        merged_at = raw.get("merged_at")
        closed_at = raw.get("closed_at")
        state = "merged" if merged_at else raw["state"]  # "open" | "closed" | "merged"
        return {
            "pr_number": raw["number"],
            "title": raw["title"] or "",
            "state": state,
            "author_login": (raw.get("user") or {}).get("login", ""),
            "created_at": self._parse_dt(raw.get("created_at")),
            "merged_at": self._parse_dt(merged_at),
            "closed_at": self._parse_dt(closed_at),
            "html_url": raw.get("html_url", ""),
            "reviews_requested": len(raw.get("requested_reviewers", [])),
            "draft": raw.get("draft", False),
        }

    def _parse_dt(self, s: str | None) -> datetime | None:
        if not s:
            return None
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
