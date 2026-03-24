from __future__ import annotations

from typing import Any

from app.services.llm.base import LLMService

_SYSTEM_PROMPT = (
    "You are an expert software engineering teaching assistant. "
    "Analyze student GitHub repository data and provide clear, concise, "
    "actionable summaries for instructors. Be specific and objective."
)


class SummaryService:
    def __init__(self, llm: LLMService) -> None:
        self._llm = llm

    async def generate_repo_overview(self, repo_data: dict[str, Any]) -> str:
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

        recent_messages = "\n".join(
            f"  - {c.get('message', '')[:80]}" for c in commits[:5]
        )

        prompt = f"""Provide a concise overview of the following student GitHub repository for an instructor.

Repository: {name}
URL: {github_url}
Health Status: {health_status}
Health Scores: {health_score}
Total Commits: {commit_count}
Contributors: {contributor_names}

Recent commit messages:
{recent_messages}

Write 2-4 paragraphs covering: overall activity level, collaboration patterns, \
code quality signals from commit messages, and any concerns the instructor should be aware of."""

        return await self._llm.generate(prompt, system=_SYSTEM_PROMPT, max_tokens=512)

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

        recent_messages = "\n".join(
            f"  - [{str(c.get('date', ''))[:10]}] {c.get('message', '')[:80]}"
            for c in commits[:10]
        )

        total_insertions = sum(c.get("insertions", 0) for c in commits)
        total_deletions = sum(c.get("deletions", 0) for c in commits)

        prompt = f"""Summarize the activity of a student contributor in a GitHub repository for their instructor.

Student: {display_name}
Known aliases: {alias_info}
Repository: {repo_name}
Total commits: {commit_count}
Total lines added: {total_insertions}
Total lines removed: {total_deletions}

Recent commit messages:
{recent_messages}

Write 1-3 paragraphs covering: contribution frequency and consistency, \
quality of commit messages, areas of the codebase worked on, and overall engagement level."""

        return await self._llm.generate(prompt, system=_SYSTEM_PROMPT, max_tokens=400)

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

        prompt = f"""Explain the health assessment of a student GitHub repository in plain English for an instructor.

Repository: {repo_name}
Overall Status: {status.upper()}
Composite Score: {composite:.1%}

Signal Breakdown:
- Commit Frequency: {score_labels.get(int(commit_frequency), str(commit_frequency))}
- Recency (last commit): {score_labels.get(int(recency), str(recency))}
- Contribution Distribution: {score_labels.get(int(distribution), str(distribution))}
- Branch Activity: {score_labels.get(int(branch_activity), str(branch_activity))}
- Commit Message Quality: {score_labels.get(int(commit_message_quality), str(commit_message_quality))}

Write 1-2 paragraphs explaining what these scores mean in practical terms, \
what the students are doing well, and what they should improve."""

        return await self._llm.generate(prompt, system=_SYSTEM_PROMPT, max_tokens=350)
