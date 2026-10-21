"""Linear's GraphQL API — the single point of contact for it.

Read live, per viewer: every call uses the signed-in user's own Linear key
(`users.linear_api_key`), and nothing fetched here is stored. The only Linear
state RepoPulse keeps is `repos.linear_team_id`, the team someone picked.

Which team belongs to a repo is decided by `resolve_team` alone: the picked team
if there is one, otherwise `match_team`'s guess from the repo name. Repo Detail
(`build_repo_linear`) and the dashboard (`build_repo_team_summaries`) both go
through it, so they cannot disagree about a repo's team.
"""
from __future__ import annotations

import asyncio
import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Literal

import httpx

from app.models.repo import Repo
from app.schemas.linear import (
    LinearCycleProgress,
    LinearMemberStats,
    LinearStatusCounts,
    LinearTeamRead,
    LinearTeamStats,
    LinearWeeklyCompletion,
    RepoLinearResponse,
    RepoLinearTeamSummary,
)

API_URL = "https://api.linear.app/graphql"

# Linear's largest page, and the most pages fetched for one team. 8 × 250 =
# 2,000 issues bounds the work behind a single panel load; a student team is
# nowhere near it, and a team that is gets stats over its 2,000 newest issues.
ISSUE_PAGE_SIZE = 250
MAX_ISSUE_PAGES = 8

WEEKS_OF_HISTORY = 6
UNASSIGNED = "Unassigned"
_OPEN_TYPES = frozenset({"triage", "backlog", "unstarted", "started"})


class LinearAuthError(Exception):
    """Linear rejected the API key. The user has to fix it in Settings."""


class LinearAPIError(Exception):
    """Linear was unreachable or answered with an error other than auth."""


@dataclass(frozen=True)
class LinearTeam:
    id: str
    key: str
    name: str

    def to_read(self) -> LinearTeamRead:
        return LinearTeamRead(id=self.id, key=self.key, name=self.name)


# ---------------------------------------------------------------------------
# Matching a repo to a team
# ---------------------------------------------------------------------------

_CAMEL_BOUNDARY = re.compile(r"(?<=[a-z])(?=[A-Z])")
_DIGIT_BOUNDARY = re.compile(r"(?<=[A-Za-z])(?=\d)|(?<=\d)(?=[A-Za-z])")
_SEPARATORS = re.compile(r"[^a-z0-9]+")


def _tokens(text: str) -> list[str]:
    """'cs4530-TeamFalcon' -> ['cs', '4530', 'team', 'falcon']."""
    text = _DIGIT_BOUNDARY.sub(" ", _CAMEL_BOUNDARY.sub(" ", text))
    return [t for t in _SEPARATORS.split(text.lower()) if t]


def match_team(repo_name: str, teams: list[LinearTeam]) -> LinearTeam | None:
    """Guess the Linear team for a repo from its name, or None.

    A team whose whole name equals the repo name wins outright ("Team Falcon"
    for `team-falcon`). Otherwise a team matches when every word of its name
    appears in the repo name, and more matched words beat fewer ("Team Falcon"
    over "Team" for `team-falcon-app`). Words are whole tokens, so "Team 1"
    does not match `team-12`.

    A tie returns None rather than picking one: showing one team's stats on
    another team's repo is worse than showing none, and the panel offers a
    manual pick either way.
    """
    repo_tokens = _tokens(repo_name)
    if not repo_tokens:
        return None
    repo_compact = "".join(repo_tokens)
    repo_set = set(repo_tokens)

    scored: list[tuple[tuple[int, int], LinearTeam]] = []
    for team in teams:
        team_tokens = _tokens(team.name)
        if not team_tokens:
            continue
        if "".join(team_tokens) == repo_compact:
            scored.append(((1, len(team_tokens)), team))
        elif set(team_tokens) <= repo_set:
            scored.append(((0, len(team_tokens)), team))

    if not scored:
        return None
    best = max(score for score, _ in scored)
    winners = [team for score, team in scored if score == best]
    return winners[0] if len(winners) == 1 else None


# ---------------------------------------------------------------------------
# Aggregating issues into stats
# ---------------------------------------------------------------------------


def _parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _week_start(day: date) -> date:
    return day - timedelta(days=day.weekday())


def summarize_team(
    issues: list[dict], active_cycle: dict | None, *, now: datetime
) -> LinearTeamStats:
    """Fold raw Linear issue nodes into the panel's stats.

    `issues` are GraphQL nodes shaped like ISSUES_QUERY selects them. Issues
    whose state type is not one of Linear's six are skipped everywhere, so
    `total_issues` always equals the sum of `status_counts`.
    """
    counts = {state_type: 0 for state_type in LinearStatusCounts.model_fields}

    this_week = _week_start(now.astimezone(timezone.utc).date())
    weekly = {
        this_week - timedelta(weeks=n): 0 for n in reversed(range(WEEKS_OF_HISTORY))
    }

    members: dict[str, LinearMemberStats] = {}
    cycle_id = active_cycle["id"] if active_cycle else None
    cycle_total = cycle_done = 0

    for issue in issues:
        state_type = (issue.get("state") or {}).get("type")
        if state_type not in counts:
            continue
        counts[state_type] += 1
        is_done = state_type == "completed"

        if is_done:
            completed_at = _parse_dt(issue.get("completedAt"))
            if completed_at is not None:
                week = _week_start(completed_at.astimezone(timezone.utc).date())
                if week in weekly:
                    weekly[week] += 1

        # Canceled work is neither someone's open load nor their output.
        if state_type == "canceled":
            continue

        name = (issue.get("assignee") or {}).get("name") or UNASSIGNED
        member = members.setdefault(name, LinearMemberStats(name=name, open=0, completed=0))
        if is_done:
            member.completed += 1
        elif state_type in _OPEN_TYPES:
            member.open += 1

        if cycle_id is not None and (issue.get("cycle") or {}).get("id") == cycle_id:
            cycle_total += 1
            cycle_done += int(is_done)

    cycle = None
    if active_cycle:
        cycle = LinearCycleProgress(
            number=active_cycle["number"],
            name=active_cycle.get("name"),
            starts_at=_parse_dt(active_cycle["startsAt"]),
            ends_at=_parse_dt(active_cycle["endsAt"]),
            progress=float(active_cycle.get("progress") or 0.0),
            issue_count=cycle_total,
            completed_issue_count=cycle_done,
        )

    return LinearTeamStats(
        status_counts=LinearStatusCounts(**counts),
        total_issues=sum(counts.values()),
        active_cycle=cycle,
        completed_per_week=[
            LinearWeeklyCompletion(week_start=week, completed=n)
            for week, n in weekly.items()
        ],
        members=sorted(
            members.values(),
            key=lambda m: (m.name == UNASSIGNED, -(m.open + m.completed), m.name.lower()),
        ),
    )


# ---------------------------------------------------------------------------
# HTTP client
# ---------------------------------------------------------------------------

TEAMS_QUERY = """
query Teams {
  teams(first: 250) {
    nodes { id key name }
  }
}
"""

ISSUES_QUERY = """
query TeamIssues($teamId: String!, $first: Int!, $after: String) {
  team(id: $teamId) {
    activeCycle { id number name startsAt endsAt progress }
    issues(first: $first, after: $after) {
      nodes {
        state { type }
        assignee { id name }
        completedAt
        cycle { id }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
}
"""

def _is_auth_error(errors: list | None) -> bool:
    for error in errors or []:
        extensions = (error or {}).get("extensions") or {}
        if extensions.get("code") == "AUTHENTICATION_ERROR":
            return True
        if "authentication" in str(extensions.get("type", "")).lower():
            return True
    return False


class LinearService:
    def __init__(
        self, api_key: str, transport: httpx.AsyncBaseTransport | None = None
    ) -> None:
        self._api_key = api_key
        # Injectable so tests can answer with httpx.MockTransport.
        self._transport = transport

    async def _query(self, query: str, variables: dict | None = None) -> dict:
        # Personal API keys go in bare. "Bearer" is only for OAuth tokens, and
        # Linear rejects a personal key sent with it.
        headers = {"Authorization": self._api_key, "Content-Type": "application/json"}
        try:
            async with httpx.AsyncClient(timeout=20.0, transport=self._transport) as client:
                resp = await client.post(
                    API_URL,
                    json={"query": query, "variables": variables or {}},
                    headers=headers,
                )
        except httpx.HTTPError as exc:
            raise LinearAPIError(f"Could not reach Linear: {exc}") from exc

        try:
            body = resp.json()
        except ValueError:
            body = {}
        errors = body.get("errors") if isinstance(body, dict) else None

        if resp.status_code == 401 or _is_auth_error(errors):
            raise LinearAuthError("Linear rejected the API key")
        if resp.status_code >= 400 or errors:
            message = (errors or [{}])[0].get("message") or f"HTTP {resp.status_code}"
            raise LinearAPIError(f"Linear API error: {message}"[:300])
        return body.get("data") or {}

    async def list_teams(self) -> list[LinearTeam]:
        data = await self._query(TEAMS_QUERY)
        return [
            LinearTeam(id=node["id"], key=node["key"], name=node["name"])
            for node in (data.get("teams") or {}).get("nodes", [])
        ]

    async def fetch_team_stats(
        self, team_id: str, *, now: datetime | None = None
    ) -> LinearTeamStats:
        issues: list[dict] = []
        active_cycle: dict | None = None
        after: str | None = None

        for _ in range(MAX_ISSUE_PAGES):
            data = await self._query(
                ISSUES_QUERY,
                {"teamId": team_id, "first": ISSUE_PAGE_SIZE, "after": after},
            )
            team = data.get("team")
            if team is None:
                raise LinearAPIError(f"Linear team {team_id} not found")
            active_cycle = team.get("activeCycle")
            page = team.get("issues") or {}
            issues.extend(page.get("nodes", []))
            page_info = page.get("pageInfo") or {}
            if not page_info.get("hasNextPage"):
                break
            after = page_info.get("endCursor")

        return summarize_team(
            issues, active_cycle, now=now or datetime.now(timezone.utc)
        )


# ---------------------------------------------------------------------------
# Which team a repo shows — Repo Detail and the dashboard
# ---------------------------------------------------------------------------

# Teams' stats are fetched concurrently for the dashboard, a few at a time, so
# a collection of many teams neither serializes into a slow page nor fires a
# burst Linear would rate-limit.
MAX_CONCURRENT_TEAM_FETCHES = 4


def resolve_team(
    repo: Repo, teams: list[LinearTeam]
) -> tuple[LinearTeam | None, Literal["manual", "auto"] | None]:
    """The team a repo shows, and how it was chosen. The one rule for this.

    The picked team (`repos.linear_team_id`) if there is one, else `match_team`
    on the repo name. A picked team the viewer's key cannot see (linked by
    someone in a different workspace) resolves to no team rather than falling
    back to a name match, which would show a different team than the one
    chosen — so it returns (None, "manual").
    """
    if repo.linear_team_id:
        return next((t for t in teams if t.id == repo.linear_team_id), None), "manual"
    team = match_team(repo.name, teams)
    return (team, "auto") if team else (None, None)


async def build_repo_linear(
    repo: Repo, api_key: str | None, *, can_change_team: bool
) -> RepoLinearResponse:
    """The Repo Detail panel: the repo's team, read with the viewer's key.

    Raises LinearAuthError / LinearAPIError; the route turns them into errors.
    """
    if not api_key:
        return RepoLinearResponse(status="not_configured", can_change_team=can_change_team)

    client = LinearService(api_key)
    team, matched_by = resolve_team(repo, await client.list_teams())
    if team is None:
        return RepoLinearResponse(
            status="no_team", matched_by=matched_by, can_change_team=can_change_team
        )

    return RepoLinearResponse(
        status="ok",
        team=team.to_read(),
        matched_by=matched_by,
        stats=await client.fetch_team_stats(team.id),
        can_change_team=can_change_team,
    )


async def build_repo_team_summaries(
    repos: list[Repo], api_key: str
) -> list[RepoLinearTeamSummary]:
    """The dashboard's Linear box: every repo that shows a team, with its stats.

    Repos with no team are left out. Each team's stats are fetched once however
    many repos share it, and nothing is called at all for an empty repo list.

    Raises LinearAuthError / LinearAPIError; the route turns them into errors.
    """
    if not repos:
        return []

    client = LinearService(api_key)
    teams = await client.list_teams()
    linked = [
        (repo, team, matched_by)
        for repo in repos
        for team, matched_by in [resolve_team(repo, teams)]
        if team is not None
    ]

    limit = asyncio.Semaphore(MAX_CONCURRENT_TEAM_FETCHES)

    async def fetch(team_id: str) -> tuple[str, LinearTeamStats]:
        async with limit:
            return team_id, await client.fetch_team_stats(team_id)

    team_ids = {team.id for _, team, _ in linked}
    stats = dict(await asyncio.gather(*(fetch(team_id) for team_id in team_ids)))

    return sorted(
        (
            RepoLinearTeamSummary(
                repo_id=repo.id,
                repo_name=repo.name,
                collection_id=repo.collection_id,
                team=team.to_read(),
                matched_by=matched_by,
                stats=stats[team.id],
            )
            for repo, team, matched_by in linked
        ),
        key=lambda summary: summary.repo_name.lower(),
    )
