from __future__ import annotations

from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import Any


class HealthService:
    """Computes health signals and composite score for a repository."""

    def compute_health(
        self,
        commits: list[dict[str, Any]],
        branches: list[str],
        expected_contributor_count: int | None = None,
        actual_contributor_count: int | None = None,
    ) -> dict[str, Any]:
        """Compute all health signals plus composite.

        Signal scores are 0 (red), 1 (yellow), or 2 (green).
        When expected_contributor_count is provided, 6 signals are used and
        composite is score sum / (6 * 2). Otherwise 5 signals are used and
        composite is score sum / (5 * 2). Both ranges are 0.0 to 1.0.

        Returns a dict matching the HealthBreakdown schema.
        """
        now = datetime.now(timezone.utc)

        cf_score = self._commit_frequency_score(commits, now)
        rec_score = self._recency_score(commits, now)
        dist_score = self._distribution_score(commits)
        branch_score = self._branch_activity_score(branches, commits, now)
        msg_score = self._commit_message_quality_score(commits)

        actual = (
            actual_contributor_count
            if actual_contributor_count is not None
            else len(set(c["author_email"].lower() for c in commits))
        )
        # Participation is only measurable against an expected contributor
        # count. Without one it is omitted rather than defaulted
        participation_score: int | None = (
            self._participation_score(actual, expected_contributor_count)
            if expected_contributor_count
            else None
        )

        raw_sum = cf_score + rec_score + dist_score + branch_score + msg_score
        max_sum = 5 * 2
        if participation_score is not None:
            raw_sum += participation_score
            max_sum += 2

        composite = raw_sum / max_sum

        if composite >= 0.75:
            status = "green"
        elif composite >= 0.375:
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
        self, commits: list[dict[str, Any]], now: datetime
    ) -> int:
        """Commits per week over the last 4 weeks.

        Green (2): >= 10/week
        Yellow (1): 4-9/week
        Red (0): <= 3/week
        """
        four_weeks_ago = now - timedelta(weeks=4)
        recent = [c for c in commits if self._ensure_tz(c["date"]) >= four_weeks_ago]
        weekly_avg = len(recent) / 4.0

        if weekly_avg >= 10:
            return 2
        elif weekly_avg >= 4:
            return 1
        else:
            return 0

    def _recency_score(self, commits: list[dict[str, Any]], now: datetime) -> int:
        """Days since most recent commit.

        Green (2): < 3 days
        Yellow (1): 3-7 days
        Red (0): > 7 days (or no commits)
        """
        if not commits:
            return 0

        latest = max(self._ensure_tz(c["date"]) for c in commits)
        days_ago = (now - latest).total_seconds() / 86400

        if days_ago < 3:
            return 2
        elif days_ago <= 7:
            return 1
        else:
            return 0

    def _distribution_score(self, commits: list[dict[str, Any]]) -> int:
        """Gini coefficient of commits per contributor.

        Green (2): Gini < 0.35
        Yellow (1): 0.35-0.60
        Red (0): > 0.60 (or single contributor)
        """
        if not commits:
            return 0

        counts = Counter(c["author_email"] for c in commits)
        values = sorted(counts.values())
        n = len(values)

        if n == 1:
            # Only one contributor — maximum inequality
            return 0

        gini = self._gini(values)

        if gini < 0.35:
            return 2
        elif gini <= 0.60:
            return 1
        else:
            return 0

    def _branch_activity_score(
        self,
        branches: list[str],
        commits: list[dict[str, Any]],
        now: datetime,
    ) -> int:
        """Number/activity of branches.

        Green (2): >= 2 branches
        Yellow (1): exactly 1 branch with recent activity (commit in last 7 days)
        Red (0): 1 branch with no recent activity, or no branches
        """
        n = len(branches)
        if n >= 2:
            return 2
        elif n == 1:
            # Check for recent commit
            week_ago = now - timedelta(days=7)
            has_recent = any(
                self._ensure_tz(c["date"]) >= week_ago for c in commits
            )
            return 1 if has_recent else 0
        else:
            return 0

    def _commit_message_quality_score(self, commits: list[dict[str, Any]]) -> int:
        """Percentage of commits with low-quality messages.

        Low quality = message < 10 chars or single word.

        Green (2): < 10% low quality
        Yellow (1): 10-30% low quality
        Red (0): > 30% low quality (or no commits)
        """
        if not commits:
            return 0

        low_quality = 0
        for c in commits:
            msg = c["message"].strip()
            if len(msg) < 10 or len(msg.split()) <= 1:
                low_quality += 1

        pct = low_quality / len(commits)
        if pct < 0.10:
            return 2
        elif pct <= 0.30:
            return 1
        else:
            return 0

    def _participation_score(self, actual: int, expected: int) -> int:
        """Actual vs expected unique contributors.

        Green (2): actual >= expected
        Yellow (1): actual >= 60% of expected
        Red (0): actual < 60% of expected
        """
        ratio = actual / expected
        if ratio >= 1.0:
            return 2
        elif ratio >= 0.6:
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
