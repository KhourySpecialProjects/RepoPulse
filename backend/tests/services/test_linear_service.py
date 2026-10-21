"""Tests for linear_service: team matching, stats aggregation, and API errors.

No test here reaches api.linear.app. Matching and aggregation are pure
functions; the HTTP client is exercised through an `httpx.MockTransport`.
"""
from __future__ import annotations

import json
from datetime import date, datetime, timezone
from types import SimpleNamespace

import httpx
import pytest

from app.services.linear_service import (
    MAX_ISSUE_PAGES,
    LinearAPIError,
    LinearAuthError,
    LinearService,
    LinearTeam,
    match_team,
    resolve_team,
    summarize_team,
)

# A Tuesday, so the current week (Monday start) is 2026-10-19.
NOW = datetime(2026, 10, 20, 12, 0, tzinfo=timezone.utc)

FALCON = LinearTeam(id="t-falcon", key="FAL", name="Falcon")
HAWK = LinearTeam(id="t-hawk", key="HAW", name="Hawk")


# ---------------------------------------------------------------------------
# match_team
# ---------------------------------------------------------------------------


class TestMatchTeam:
    def test_exact_name_match(self):
        assert match_team("falcon", [HAWK, FALCON]) == FALCON

    def test_ignores_case_and_separators(self):
        team = LinearTeam(id="t1", key="TF", name="Team Falcon")
        assert match_team("TEAM_falcon", [team, HAWK]) == team

    def test_team_name_contained_in_repo_name(self):
        assert match_team("team-falcon-app", [HAWK, FALCON]) == FALCON

    def test_camel_case_repo_name_is_split(self):
        assert match_team("FalconApp", [HAWK, FALCON]) == FALCON

    def test_exact_match_beats_partial_match(self):
        falcon_app = LinearTeam(id="t2", key="FA", name="Falcon App")
        assert match_team("falcon-app", [FALCON, falcon_app]) == falcon_app

    def test_numbers_match_as_whole_tokens(self):
        team_1 = LinearTeam(id="t1", key="T1", name="Team 1")
        team_12 = LinearTeam(id="t12", key="T12", name="Team 12")
        assert match_team("cs4530-team-12", [team_1, team_12]) == team_12

    def test_ambiguous_match_returns_none(self):
        # Both teams are partial matches of equal strength — guessing would put
        # one team's stats on the other's repo.
        assert match_team("falcon-hawk", [FALCON, HAWK]) is None

    def test_no_match_returns_none(self):
        assert match_team("eagle", [FALCON, HAWK]) is None

    def test_no_teams_returns_none(self):
        assert match_team("falcon", []) is None


# ---------------------------------------------------------------------------
# summarize_team
# ---------------------------------------------------------------------------


def _issue(
    state: str,
    assignee: str | None = None,
    completed_at: str | None = None,
    cycle_id: str | None = None,
) -> dict:
    return {
        "state": {"type": state},
        "assignee": {"id": f"u-{assignee}", "name": assignee} if assignee else None,
        "completedAt": completed_at,
        "cycle": {"id": cycle_id} if cycle_id else None,
    }


class TestSummarizeTeam:
    def test_counts_issues_by_state_type(self):
        issues = [
            _issue("triage"),
            _issue("backlog"),
            _issue("backlog"),
            _issue("unstarted"),
            _issue("started"),
            _issue("completed", completed_at="2026-10-19T09:00:00.000Z"),
            _issue("canceled"),
        ]
        stats = summarize_team(issues, None, now=NOW)
        counts = stats.status_counts
        assert counts.triage == 1
        assert counts.backlog == 2
        assert counts.unstarted == 1
        assert counts.started == 1
        assert counts.completed == 1
        assert counts.canceled == 1
        assert stats.total_issues == 7

    def test_unknown_state_types_are_not_counted(self):
        stats = summarize_team([_issue("mystery"), _issue("started")], None, now=NOW)
        assert stats.total_issues == 1

    def test_completed_per_week_covers_six_weeks_oldest_first(self):
        issues = [
            _issue("completed", completed_at="2026-10-19T09:00:00.000Z"),  # this week
            _issue("completed", completed_at="2026-10-20T08:00:00.000Z"),  # this week
            _issue("completed", completed_at="2026-10-14T23:00:00.000Z"),  # last week
            _issue("completed", completed_at="2026-09-14T00:30:00.000Z"),  # 5 weeks ago
        ]
        weeks = summarize_team(issues, None, now=NOW).completed_per_week
        assert [w.week_start for w in weeks] == [
            date(2026, 9, 14),
            date(2026, 9, 21),
            date(2026, 9, 28),
            date(2026, 10, 5),
            date(2026, 10, 12),
            date(2026, 10, 19),
        ]
        assert [w.completed for w in weeks] == [1, 0, 0, 0, 1, 2]

    def test_completions_before_the_window_are_left_out(self):
        issues = [_issue("completed", completed_at="2026-09-13T23:59:00.000Z")]
        weeks = summarize_team(issues, None, now=NOW).completed_per_week
        assert sum(w.completed for w in weeks) == 0

    def test_member_breakdown(self):
        issues = [
            _issue("started", assignee="Alice"),
            _issue("completed", assignee="Alice", completed_at="2026-10-19T09:00:00.000Z"),
            _issue("completed", assignee="Alice", completed_at="2026-10-01T09:00:00.000Z"),
            _issue("backlog", assignee="Bob"),
            _issue("unstarted"),
            # Canceled work is neither open nor completed.
            _issue("canceled", assignee="Bob"),
        ]
        members = summarize_team(issues, None, now=NOW).members
        assert [(m.name, m.open, m.completed) for m in members] == [
            ("Alice", 1, 2),
            ("Bob", 1, 0),
            ("Unassigned", 1, 0),
        ]

    def test_active_cycle_progress(self):
        cycle = {
            "id": "c-4",
            "number": 4,
            "name": "Sprint 4",
            "startsAt": "2026-10-12T00:00:00.000Z",
            "endsAt": "2026-10-26T00:00:00.000Z",
            "progress": 0.5,
        }
        issues = [
            _issue("completed", cycle_id="c-4", completed_at="2026-10-19T09:00:00.000Z"),
            _issue("started", cycle_id="c-4"),
            _issue("started", cycle_id="c-3"),
            _issue("backlog"),
        ]
        active = summarize_team(issues, cycle, now=NOW).active_cycle
        assert active is not None
        assert active.number == 4
        assert active.name == "Sprint 4"
        assert active.starts_at == datetime(2026, 10, 12, tzinfo=timezone.utc)
        assert active.ends_at == datetime(2026, 10, 26, tzinfo=timezone.utc)
        assert active.progress == 0.5
        assert active.issue_count == 2
        assert active.completed_issue_count == 1

    def test_no_active_cycle(self):
        assert summarize_team([_issue("started")], None, now=NOW).active_cycle is None


# ---------------------------------------------------------------------------
# LinearService HTTP behaviour
# ---------------------------------------------------------------------------


def _service(handler) -> LinearService:
    return LinearService("lin_api_secret", transport=httpx.MockTransport(handler))


class TestListTeams:
    async def test_sends_key_without_bearer_prefix_and_parses_teams(self):
        seen: list[httpx.Request] = []

        def handler(request: httpx.Request) -> httpx.Response:
            seen.append(request)
            return httpx.Response(
                200,
                json={
                    "data": {
                        "teams": {
                            "nodes": [
                                {"id": "t-falcon", "key": "FAL", "name": "Falcon"},
                                {"id": "t-hawk", "key": "HAW", "name": "Hawk"},
                            ]
                        }
                    }
                },
            )

        teams = await _service(handler).list_teams()

        assert teams == [FALCON, HAWK]
        assert str(seen[0].url) == "https://api.linear.app/graphql"
        # Personal API keys are sent bare; "Bearer" is for OAuth tokens only.
        assert seen[0].headers["Authorization"] == "lin_api_secret"

    async def test_authentication_error_in_body_raises_auth_error(self):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                400,
                json={
                    "errors": [
                        {
                            "message": "Authentication required, not authenticated",
                            "extensions": {
                                "type": "authentication error",
                                "code": "AUTHENTICATION_ERROR",
                            },
                        }
                    ]
                },
            )

        with pytest.raises(LinearAuthError):
            await _service(handler).list_teams()

    async def test_http_401_raises_auth_error(self):
        with pytest.raises(LinearAuthError):
            await _service(lambda r: httpx.Response(401, text="nope")).list_teams()

    async def test_server_error_raises_api_error(self):
        with pytest.raises(LinearAPIError):
            await _service(lambda r: httpx.Response(503, text="down")).list_teams()

    async def test_graphql_error_raises_api_error(self):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200, json={"data": None, "errors": [{"message": "Query too complex"}]}
            )

        with pytest.raises(LinearAPIError):
            await _service(handler).list_teams()

    async def test_network_failure_raises_api_error(self):
        def handler(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("unreachable", request=request)

        with pytest.raises(LinearAPIError):
            await _service(handler).list_teams()

    def test_auth_error_is_not_an_api_error(self):
        # The route answers the two differently (fix your key vs. try later),
        # so one must not be caught by the other's except clause.
        assert not issubclass(LinearAuthError, LinearAPIError)
        assert not issubclass(LinearAPIError, LinearAuthError)


def _issues_page(nodes: list[dict], *, has_next: bool, cursor: str | None) -> dict:
    return {
        "data": {
            "team": {
                "activeCycle": None,
                "issues": {
                    "nodes": nodes,
                    "pageInfo": {"hasNextPage": has_next, "endCursor": cursor},
                },
            }
        }
    }


class TestFetchTeamStats:
    async def test_follows_pagination_and_summarizes_every_page(self):
        cursors: list[str | None] = []

        def handler(request: httpx.Request) -> httpx.Response:
            variables = json.loads(request.content)["variables"]
            assert variables["teamId"] == "t-falcon"
            cursors.append(variables.get("after"))
            if variables.get("after") is None:
                return httpx.Response(
                    200,
                    json=_issues_page(
                        [_issue("started"), _issue("backlog")], has_next=True, cursor="c1"
                    ),
                )
            return httpx.Response(
                200, json=_issues_page([_issue("started")], has_next=False, cursor=None)
            )

        stats = await _service(handler).fetch_team_stats("t-falcon", now=NOW)

        assert cursors == [None, "c1"]
        assert stats.total_issues == 3
        assert stats.status_counts.started == 2

    async def test_stops_after_max_pages(self):
        calls = 0

        def handler(request: httpx.Request) -> httpx.Response:
            nonlocal calls
            calls += 1
            return httpx.Response(
                200,
                json=_issues_page([_issue("started")], has_next=True, cursor=f"c{calls}"),
            )

        stats = await _service(handler).fetch_team_stats("t-falcon", now=NOW)

        assert calls == MAX_ISSUE_PAGES
        assert stats.total_issues == MAX_ISSUE_PAGES

    async def test_uses_active_cycle_from_response(self):
        def handler(request: httpx.Request) -> httpx.Response:
            body = _issues_page([_issue("started", cycle_id="c-9")], has_next=False, cursor=None)
            body["data"]["team"]["activeCycle"] = {
                "id": "c-9",
                "number": 9,
                "name": None,
                "startsAt": "2026-10-12T00:00:00.000Z",
                "endsAt": "2026-10-26T00:00:00.000Z",
                "progress": 0.0,
            }
            return httpx.Response(200, json=body)

        stats = await _service(handler).fetch_team_stats("t-falcon", now=NOW)

        assert stats.active_cycle is not None
        assert stats.active_cycle.number == 9
        assert stats.active_cycle.issue_count == 1


# ---------------------------------------------------------------------------
# resolve_team — the one rule for which team a repo shows
# ---------------------------------------------------------------------------


def _repo(name: str, linear_team_id: str | None = None) -> SimpleNamespace:
    # resolve_team reads only these two attributes of a Repo.
    return SimpleNamespace(name=name, linear_team_id=linear_team_id)


class TestResolveTeam:
    def test_a_picked_team_wins_over_a_name_match(self):
        assert resolve_team(_repo("team-falcon", "t-hawk"), [FALCON, HAWK]) == (HAWK, "manual")

    def test_a_picked_team_the_key_cannot_see_resolves_to_nothing(self):
        # Not a fallback to the name match: that would show a different team
        # from the one someone chose.
        assert resolve_team(_repo("team-falcon", "t-elsewhere"), [FALCON]) == (None, "manual")

    def test_without_a_pick_the_name_decides(self):
        assert resolve_team(_repo("team-falcon"), [HAWK, FALCON]) == (FALCON, "auto")

    def test_without_a_pick_or_a_match_there_is_no_team(self):
        assert resolve_team(_repo("eagle"), [HAWK, FALCON]) == (None, None)
