from __future__ import annotations

from typing import Any

from app.services.llm.base import LLMService

_SYSTEM_PROMPT = (
    "You are an expert software engineering teaching assistant. "
    "Analyze student GitHub repository data and provide clear, concise, "
    "actionable summaries for instructors. Be specific and objective."
)

REPO_OVERVIEW_MAX_TOKENS = 2048


class SummaryService:
    def __init__(self, llm: LLMService) -> None:
        self._llm = llm

    async def generate_repo_overview(
        self,
        repo_data: dict[str, Any],
        instructor_instructions: str | None = None,
    ) -> str:
        """Generate a high-level overview of a repository."""
        name = repo_data.get("name", "Unknown")
        github_url = repo_data.get("github_url", "")
        health_status = repo_data.get("health_status", "unknown")
        health_score = repo_data.get("health_score", {})
        commits = repo_data.get("commits", [])
        contributors = repo_data.get("contributors", [])

        commit_count = len(commits)
        contributor_names = ", ".join(
            c.get("display_name", c.get("name", "Unknown")) for c in contributors[:10]
        )

        # Date range
        if commits:
            dates = [c["date"] for c in commits if c.get("date")]
            earliest = min(dates).strftime("%Y-%m-%d") if dates else "N/A"
            latest = max(dates).strftime("%Y-%m-%d") if dates else "N/A"
        else:
            earliest = latest = "N/A"

        # Active branches — unique, sorted, max 10
        branch_names: list[str] = []
        for c in commits:
            for b in c.get("branches", []):
                if b not in branch_names:
                    branch_names.append(b)
        active_branches = sorted(branch_names)[:10]

        # Total lines changed
        total_lines = sum(
            c.get("insertions", 0) + c.get("deletions", 0) for c in commits
        )

        # Per-contributor commit counts — top 10
        contributor_commit_counts: dict[str, int] = {}
        for c in commits:
            author = c.get("author_name", "Unknown")
            contributor_commit_counts[author] = contributor_commit_counts.get(author, 0) + 1
        top_contributors = sorted(
            contributor_commit_counts.items(), key=lambda x: x[1], reverse=True
        )[:10]
        contributor_lines = "\n".join(
            f"  - {author}: {count} commits" for author, count in top_contributors
        )

        # Recent commit messages — 15, formatted with date
        recent_messages = "\n".join(
            f"  - [{c['date'].strftime('%Y-%m-%d')}] {c.get('message', '')[:70]}"
            for c in commits[:15]
            if c.get("date")
        )

        instructions = (instructor_instructions or "").strip()
        instructor_instructions_block = instructions or "No additional instructor instructions."

        prompt = f"""Provide a concise overview of the following student GitHub repository for an instructor.

Additional instructor instructions for this summary:
<instructor_instructions>
{instructor_instructions_block}
</instructor_instructions>

Follow the additional instructor instructions while preserving the repository evidence and the requested summary format.

Repository: {name}
URL: {github_url}
Health Status: {health_status}
Health Scores: {health_score}
Total Commits: {commit_count}
Date Range: {earliest} → {latest}
Total Lines Changed (insertions + deletions): {total_lines}
Active Branches: {", ".join(active_branches) if active_branches else "none"}
Contributors: {contributor_names}

Commits per contributor (top 10):
{contributor_lines}

Recent commit messages:
{recent_messages}

Format the response as exactly four sections, each with a bold Markdown heading and one concise paragraph:
**Overall Activity and Timeline**
**Collaboration and Code Quality**
**Technical Strengths and Risks**
**Instructor Takeaway**

Cover overall activity level and timeline, collaboration patterns, code quality signals from commit messages, \
code churn and its implications, and concerns the instructor should be aware of.

This request is for the repository overview only. Return prose paragraphs only.
Do not return JSON, a commit-grading object, a grading rubric, or markdown code fences.
Finish with a complete sentence."""

        return await self._llm.generate(
            prompt,
            system=_SYSTEM_PROMPT,
            max_tokens=REPO_OVERVIEW_MAX_TOKENS,
        )

    async def generate_contributor_activity(
        self, contributor_data: dict[str, Any]
    ) -> str:
        """Generate a summary of a single contributor's activity."""
        display_name = contributor_data.get("display_name", "Unknown")
        repo_name = contributor_data.get("repo_name", "Unknown")
        commits = contributor_data.get("commits", [])
        aliases = contributor_data.get("aliases", [])

        commit_count = len(commits)
        alias_info = ", ".join(
            f"{a.get('git_name')} <{a.get('git_email')}>" for a in aliases
        )

        total_insertions = sum(c.get("insertions", 0) for c in commits)
        total_deletions = sum(c.get("deletions", 0) for c in commits)

        # Date range for this contributor
        if commits:
            dates = [c["date"] for c in commits if c.get("date")]
            earliest = min(dates).strftime("%Y-%m-%d") if dates else "N/A"
            latest = max(dates).strftime("%Y-%m-%d") if dates else "N/A"
        else:
            earliest = latest = "N/A"

        # Unique branches this contributor committed to, sorted
        branch_names: list[str] = []
        for c in commits:
            for b in c.get("branches", []):
                if b not in branch_names:
                    branch_names.append(b)
        contributor_branches = sorted(branch_names)

        # Average files changed per commit
        if commits:
            avg_files = round(
                sum(c.get("files_changed", 0) for c in commits) / len(commits), 1
            )
        else:
            avg_files = 0.0

        # Recent commit messages — 20, formatted with date and churn
        recent_messages = "\n".join(
            f"  - [{c['date'].strftime('%Y-%m-%d')}] "
            f"+{c.get('insertions', 0)}/-{c.get('deletions', 0)} "
            f"{c.get('message', '')[:65]}"
            for c in commits[:20]
            if c.get("date")
        )

        prompt = f"""Summarize the activity of a student contributor in a GitHub repository for their instructor.

Student: {display_name}
Known aliases: {alias_info}
Repository: {repo_name}
Total commits: {commit_count}
Date Range: {earliest} → {latest}
Total lines added: {total_insertions}
Total lines removed: {total_deletions}
Avg files changed per commit: {avg_files}
Branches committed to: {", ".join(contributor_branches) if contributor_branches else "none"}

Recent commit messages (with churn):
{recent_messages}

Write 1-3 paragraphs covering: contribution frequency and consistency, \
quality of commit messages, areas of the codebase worked on, and overall engagement level."""

        return await self._llm.generate(prompt, system=_SYSTEM_PROMPT, max_tokens=450)

    async def generate_health_explanation(self, health_data: dict[str, Any]) -> str:
        """Explain health scores in plain English for an instructor."""
        repo_name = health_data.get("repo_name", "Unknown")
        status = health_data.get("status", "unknown")
        composite = health_data.get("composite", 0.0)
        commit_frequency = health_data.get("commit_frequency", 0)
        recency = health_data.get("recency", 0)
        distribution = health_data.get("distribution", 0)
        branch_activity = health_data.get("branch_activity", 0)
        commit_message_quality = health_data.get("commit_message_quality", 0)

        score_labels = {0: "Red (poor)", 1: "Yellow (moderate)", 2: "Green (good)"}

        participation = health_data.get("participation")
        participation_line = ""
        if participation is not None:
            participation_line = (
                f"\n- Participation (actual vs expected contributors): "
                f"{score_labels.get(int(participation), str(participation))}"
            )

        prompt = f"""Explain the health assessment of a student GitHub repository in plain English for an instructor.

Repository: {repo_name}
Overall Status: {status.upper()}
Composite Score: {composite:.1%}

Signal Breakdown:
- Commit Frequency: {score_labels.get(int(commit_frequency), str(commit_frequency))}
- Recency (last commit): {score_labels.get(int(recency), str(recency))}
- Contribution Distribution: {score_labels.get(int(distribution), str(distribution))}
- Branch Activity: {score_labels.get(int(branch_activity), str(branch_activity))}
- Commit Message Quality: {score_labels.get(int(commit_message_quality), str(commit_message_quality))}{participation_line}

Write 1-2 paragraphs explaining what these scores mean in practical terms, \
what the students are doing well, and what they should improve."""

        return await self._llm.generate(prompt, system=_SYSTEM_PROMPT, max_tokens=350)
