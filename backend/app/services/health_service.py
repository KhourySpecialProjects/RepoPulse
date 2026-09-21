from __future__ import annotations

from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import Any

from app.services.health_thresholds import resolve_thresholds


class HealthService:
    """Computes health signals and composite score for a repository."""

    def compute_health(
        self,
        commits: list[dict[str, Any]],
        branches: list[str],
        expected_contributor_count: int | None = None,
        actual_contributor_count: int | None = None,
        thresholds: Any = None,
    ) -> dict[str, Any]:
        """Compute all health signals plus composite.

        Signal scores are 0 (red), 1 (yellow), or 2 (green).
        When expected_contributor_count is provided, 6 signals are used and
        composite is score sum / (6 * 2). Otherwise 5 signals are used and
        composite is score sum / (5 * 2). Both ranges are 0.0 to 1.0.

        `thresholds` is the owning collection's stored override, or None to
        score against the shipped defaults. It is passed through
        `resolve_thresholds`, so a partial or malformed override costs only the
        cutoffs it got wrong.

        Returns a dict matching the HealthBreakdown schema.
        """
        now = datetime.now(timezone.utc)
        t = resolve_thresholds(thresholds)

        cf_score = self._commit_frequency_score(commits, now, t["commit_frequency"])
        rec_score = self._recency_score(commits, now, t["recency"])
        dist_score = self._distribution_score(commits, t["distribution"])
        branch_score = self._branch_activity_score(
            branches, commits, now, t["branch_activity"]
        )
        msg_score = self._commit_message_quality_score(
            commits, t["commit_message_quality"]
        )

        actual = (
            actual_contributor_count
            if actual_contributor_count is not None
            else len(set(c["author_email"].lower() for c in commits))
        )
        # Participation is only measurable against an expected contributor
        # count. Without one it is omitted rather than defaulted
        participation_score: int | None = (
            self._participation_score(
                actual, expected_contributor_count, t["participation"]
            )
            if expected_contributor_count
            else None
        )

        raw_sum = cf_score + rec_score + dist_score + branch_score + msg_score
        max_sum = 5 * 2
        if participation_score is not None:
            raw_sum += participation_score
            max_sum += 2

        composite = raw_sum / max_sum

        if composite >= t["composite"]["green"]:
            status = "green"
        elif composite >= t["composite"]["yellow"]:
            status = "yellow"
        else:
            status = "red"

        return {
            "commit_frequency": float(cf_score),
            "recency": float(rec_score),
            "distribution": float(dist_score),
            "branch_activity": float(branch_score),
            "commit_message_quality": float(msg_score),
            "participation": float(participation_score) if participation_score is not None else None,
            "composite": round(composite, 4),
            "status": status,
        }

    # ------------------------------------------------------------------
    # Individual signal computations
    # ------------------------------------------------------------------

    def _commit_frequency_score(
        self,
        commits: list[dict[str, Any]],
        now: datetime,
        bounds: dict[str, float],
    ) -> int:
        """Commits per week over the last 4 weeks. Higher is better."""
        four_weeks_ago = now - timedelta(weeks=4)
        recent = [c for c in commits if self._ensure_tz(c["date"]) >= four_weeks_ago]
        weekly_avg = len(recent) / 4.0

        if weekly_avg >= bounds["green"]:
            return 2
        elif weekly_avg >= bounds["yellow"]:
            return 1
        else:
            return 0

    def _recency_score(
        self,
        commits: list[dict[str, Any]],
        now: datetime,
        bounds: dict[str, float],
    ) -> int:
        """Days since the most recent commit. Lower is better."""
        if not commits:
            return 0

        latest = max(self._ensure_tz(c["date"]) for c in commits)
        days_ago = (now - latest).total_seconds() / 86400

        if days_ago < bounds["green"]:
            return 2
        elif days_ago <= bounds["yellow"]:
            return 1
        else:
            return 0

    def _distribution_score(
        self, commits: list[dict[str, Any]], bounds: dict[str, float]
    ) -> int:
        """Gini coefficient of commits per contributor. Lower is more even."""
        if not commits:
            return 0

        counts = Counter(c["author_email"] for c in commits)
        values = sorted(counts.values())
        n = len(values)

        if n == 1:
            # Only one contributor — maximum inequality, regardless of cutoffs.
            return 0

        gini = self._gini(values)

        if gini < bounds["green"]:
            return 2
        elif gini <= bounds["yellow"]:
            return 1
        else:
            return 0

    def _branch_activity_score(
        self,
        branches: list[str],
        commits: list[dict[str, Any]],
        now: datetime,
        bounds: dict[str, float],
    ) -> int:
        """Active branch count. Higher is better.

        At the yellow bound the branches must also have seen a commit in the
        last week — a lone stale branch scores red, not yellow.
        """
        n = len(branches)
        if n >= bounds["green"]:
            return 2
        elif n >= bounds["yellow"]:
            week_ago = now - timedelta(days=7)
            has_recent = any(
                self._ensure_tz(c["date"]) >= week_ago for c in commits
            )
            return 1 if has_recent else 0
        else:
            return 0

    def _commit_message_quality_score(
        self, commits: list[dict[str, Any]], bounds: dict[str, float]
    ) -> int:
        """Fraction of commits with low-quality messages. Lower is better.

        Low quality = under 10 characters, or a single word.
        """
        if not commits:
            return 0

        low_quality = 0
        for c in commits:
            msg = c["message"].strip()
            if len(msg) < 10 or len(msg.split()) <= 1:
                low_quality += 1

        pct = low_quality / len(commits)
        if pct < bounds["green"]:
            return 2
        elif pct <= bounds["yellow"]:
            return 1
        else:
            return 0

    def _participation_score(
        self, actual: int, expected: int, bounds: dict[str, float]
    ) -> int:
        """Actual over expected unique contributors. Higher is better."""
        ratio = actual / expected
        if ratio >= bounds["green"]:
            return 2
        elif ratio >= bounds["yellow"]:
            return 1
        else:
            return 0

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _ensure_tz(dt: datetime) -> datetime:
        if dt.tzinfo is None:
            return dt.replace(tzinfo=timezone.utc)
        return dt

    @staticmethod
    def _gini(values: list[int]) -> float:
        """Compute Gini coefficient for a sorted list of non-negative ints."""
        n = len(values)
        if n == 0:
            return 0.0
        total = sum(values)
        if total == 0:
            return 0.0

        cumulative = 0.0
        for i, v in enumerate(values, start=1):
            cumulative += v * (2 * i - n - 1)

        return cumulative / (n * total)
