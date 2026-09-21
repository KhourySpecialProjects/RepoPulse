# AGENTS.md — RepoPulse

**The conventions for this repository live in [`CLAUDE.md`](CLAUDE.md). Read that file.**

It is the single source of truth for project structure, the mandatory TDD
workflow, backend and frontend conventions, auth and permissions, health
scoring, LLM integration and quotas, git operations, notifications, Docker
setup, and how to run the tests. This file used to carry a second copy of all
of it, which drifted out of date — so it is a pointer now, and anything added
here that contradicts `CLAUDE.md` is a bug.

Other documents worth knowing about:

- [`README.md`](README.md) — setup, quick start, and what the app does.
- [`PRD.md`](PRD.md) — the original product brief, kept as a record of intent.
  §9.1's build order is complete; `CLAUDE.md`'s "Where Things Live" table is the
  current map.
- `docs/plans/` — design notes for larger changes.

## Tool-specific configuration

Only the agent configuration differs between tools; the conventions do not.

| Tool | Configuration |
|---|---|
| Claude Code | `.claude/settings.json`, `.claude/agents/*.md`, `.claude/skills/` |
| Codex | `.codex/config.toml`, `.codex/agents/*.toml` |

Keep the agent definitions in the two directories describing the same roles
(`backend-api`, `frontend-ui`, `seed-data`, `test-writer`), so work is
reproducible whichever tool runs it.
