# CLAUDE.md — RepoPulse

## Project Overview
RepoPulse is a web app for monitoring student GitHub project repositories. It provides health dashboards, contributor analytics, commit-quality scoring, pull-request tracking, shared notes and reminders, notifications, and AI-generated summaries — all computed from local git clones. See `PRD.md` for the original product brief and `README.md` for setup.

## Tech Stack
- **Frontend:** React 18 + Vite + TypeScript + Tailwind CSS + shadcn/ui + Framer Motion
- **Backend:** FastAPI (Python 3.11+) + SQLAlchemy 2.0 (async) + asyncpg + Alembic
- **Database:** PostgreSQL 16 (Docker container)
- **Git operations:** GitPython against local clones; the GitHub REST API for pull requests only
- **LLM:** Anthropic SDK or a local Ollama server, both behind one provider abstraction
- **Tracing:** OpenTelemetry → Arize Phoenix, opt-in via `OTEL_EXPORTER_OTLP_ENDPOINT`
- **Charts:** Recharts
- **Data fetching:** Tanstack Query (React Query)
- **Testing:** pytest + pytest-asyncio + httpx (backend), Vitest + React Testing Library + MSW (frontend), `node --test` (landing page and product tour)
- **Containerization:** Docker Compose (4 services: frontend, backend, db, phoenix)

## Project Structure
```
repo-pulse/
├── docker-compose.yml
├── Makefile
├── db/init/                       # runs once, on a fresh postgres volume
├── seed-repos/                    # clone root on the host, mounted at /repos
├── tests/                         # landing.test.cjs, tour.test.cjs
├── docs/plans/                    # design notes for larger changes
├── frontend/
│   ├── Dockerfile
│   ├── public/
│   │   ├── landing.html           # Public front door: / when signed out
│   │   └── tour.html              # The product tour the landing hero frames
│   ├── src/
│   │   ├── components/
│   │   │   ├── ui/                # shadcn components
│   │   │   ├── admin/             # admin panel tabs + overview cards
│   │   │   ├── charts/            # reusable chart primitives
│   │   │   └── dashboard/         # dashboard-only widgets
│   │   ├── contexts/
│   │   ├── pages/
│   │   ├── hooks/
│   │   ├── services/              # API client
│   │   ├── lib/                   # utilities
│   │   ├── types/
│   │   ├── mocks/                 # MSW handlers
│   │   └── __tests__/
│   ├── package.json
│   └── vite.config.ts
├── backend/
│   ├── Dockerfile
│   ├── entrypoint.sh              # alembic upgrade head, then uvicorn
│   ├── pytest.ini
│   ├── app/
│   │   ├── api/
│   │   │   └── routes/            # FastAPI routers
│   │   ├── models/                # SQLAlchemy models
│   │   ├── schemas/               # Pydantic request/response schemas
│   │   ├── services/              # Business logic layer
│   │   │   ├── git_service.py
│   │   │   ├── github_service.py
│   │   │   ├── health_service.py
│   │   │   ├── health_thresholds.py
│   │   │   ├── permission_service.py
│   │   │   ├── notification_service.py
│   │   │   ├── commit_classifier_service.py
│   │   │   ├── commit_snapshot_service.py
│   │   │   ├── account_setup_service.py
│   │   │   ├── admin_stats_service.py
│   │   │   ├── llm/
│   │   │   │   ├── base.py            # Abstract LLMService interface + TokenUsage
│   │   │   │   ├── anthropic_adapter.py
│   │   │   │   ├── ollama_adapter.py
│   │   │   │   ├── quota.py           # require_quota / record_usage
│   │   │   │   ├── user_settings.py   # resolve_llm_settings
│   │   │   │   └── criteria.py
│   │   │   └── summary_service.py
│   │   ├── db/
│   │   │   ├── database.py
│   │   │   ├── seed.py            # mock-data seed — currently commented out in full
│   │   │   ├── seed_admin.py      # bootstraps the first administrator
│   │   │   └── migrations/        # Alembic
│   │   ├── core/
│   │   │   ├── config.py          # Pydantic Settings
│   │   │   ├── auth.py
│   │   │   ├── deps.py            # FastAPI dependencies
│   │   │   └── errors.py          # AppError → error envelope
│   │   └── main.py
│   ├── scripts/                   # offline tools (classifier eval, commit harvesting)
│   ├── tests/
│   │   ├── conftest.py            # Fixtures: test db, test client, mock LLM
│   │   ├── api/
│   │   ├── core/
│   │   ├── services/
│   │   └── factories/             # Test data factories
│   ├── requirements.txt
│   └── alembic.ini
├── .claude/
│   ├── settings.json
│   └── agents/
├── CLAUDE.md
├── AGENTS.md                      # pointer to this file
├── PRD.md
└── README.md
```

## Mandatory Conventions

### TDD — Non-Negotiable
Every feature is built test-first. The workflow is always:
1. Write a failing test that defines the expected behavior.
2. Write the minimum code to make the test pass.
3. Refactor if needed, ensuring tests still pass.

**Never write implementation code without a corresponding test already in place.** If you find yourself writing implementation before a test exists, stop and write the test first.

### Backend Conventions
- **All API routes** are prefixed with `/api/v1/`.
- **All endpoints** must have Pydantic request and response schemas. No raw dicts.
- **All SQLAlchemy models** use UUID primary keys (`uuid.uuid4`).
- **All database operations** are async (use `async_session`, `asyncpg`).
- **All list endpoints** support pagination with a consistent envelope: `{"items": [...], "total": int, "limit": int, "offset": int}`.
- **All errors** return `{"detail": "...", "error_code": "..."}` with appropriate HTTP status codes. Raise `AppError` (`app/core/errors.py`) and let the handler in `main.py` build the envelope, rather than assembling it per route.
- **Auth** is JWT-based, via `Authorization: Bearer <token>` header. In dev mode (`AUTH_MODE=dev`), `POST /api/v1/auth/dev-login` accepts a user id without a password. It is an API affordance only — the login screen asks for a password in both modes.
- **Config** uses Pydantic `BaseSettings` reading from environment variables.
- **Imports** within the backend always use absolute paths from `app.` (e.g., `from app.models.repo import Repo`).
- **Service layer** is where business logic lives. Routes should be thin — validate input, call a service, return a response.

### Auth, Roles & Permissions
- Two role systems stack, and `app/services/permission_service.py` is the one place that resolves them. Do not re-derive access inline in a route.
  - **Instance role** on `users.role`: `instructor`, `ta`, `admin`. Admins reach `/api/v1/admin/*` (gated by `require_admin` in `core/deps.py`), manage users, and are never metered for LLM tokens.
  - **Collection role**: the collection's `owner_id`, plus `co_instructor` and `ta` grants in `collection_access`. An instance admin has owner power over every collection.
- **Admins never choose anyone's password.** Creating a user mints a single-use `AccountSetupToken`; the recipient sets their own password at `/account-setup`. The same row type backs password reset. It is deliberately an opaque token and not a JWT — `verify_token` validates no purpose claim, so a JWT setup link would be a full session credential. See the docstring on `app/models/account_setup_token.py` before changing it.
- The first admin cannot be created through the API, since `POST /api/v1/users` is admin-gated. `python -m app.db.seed_admin` (`make seed-admin`) is the bootstrap and lockout-recovery path.

### Frontend Conventions
- **shadcn/ui** components go in `src/components/ui/`. Custom components go in `src/components/`.
- **Pages** go in `src/pages/` and correspond to routes.
- **API calls** go through a typed API client in `src/services/api.ts`. Never call `fetch` directly from components.
- **All data fetching** uses Tanstack Query hooks (in `src/hooks/`).
- **Animations** use Framer Motion. Add entrance animations to page transitions and card layouts. Use `AnimatePresence` for route transitions.
- **Tailwind only** — no inline styles, no CSS modules, no styled-components.
- **TypeScript strict mode** — no `any` types. Define all types in `src/types/`.
- **Routes:** `/` (landing when signed out, dashboard when signed in), `/login`, `/account-setup`, `/collections`, `/collections/:id`, `/repos/:id`, `/notifications`, `/settings`, `/profile`, `/admin`.
- The landing page and product tour are **static documents in `frontend/public/`**, not React pages. `LandingPage` redirects to `/landing.html`; they carry their own stylesheet and are tested by `tests/*.test.cjs` without the stack.

### Database & ORM
- SQLAlchemy models define the schema. Alembic manages migrations.
- When changing models, always generate and review a migration: `alembic revision --autogenerate -m "description"`.
- **Alembic owns the schema.** Nothing calls `Base.metadata.create_all` except the test fixtures, and `backend/entrypoint.sh` runs `alembic upgrade head` before uvicorn. `tests/test_migrations.py` fails if the chain and the models disagree, if there is more than one head, or if the chain does not apply to an empty database — these are the checks CI gates a merge on.
- The migration history was squashed into `0001_baseline_schema`; revisions run `0001`–`0013`. Comments referring to pre-squash revision numbers are historical.
- The schema is designed for future PostgreSQL/Supabase compatibility — it is already PostgreSQL. Do not use SQLite-specific features.
- Use `relationship()` with `lazy="selectin"` as the default loading strategy to avoid N+1 queries. Note that `get_current_user_obj` loads a `User` on every authenticated request, so a new `selectin` relationship on `User` costs a query on *every* API call — see `AccountSetupToken` for why one was deliberately left off.

### Health Scoring
- Six signals, each scored 0 (red), 1 (yellow), or 2 (green): commit frequency, recency, distribution (Gini), branch activity, commit message quality, and participation.
- Participation is only scored when the repo has an `expected_contributor_count`; without one it is omitted rather than defaulted, and the composite divides by five signals instead of six.
- Composite is the score sum over the maximum, so it ranges 0.0–1.0: `≥ 0.75` green, `≥ 0.375` yellow, below that red.
- Cutoffs live in `app/services/health_thresholds.py`, not as literals in `HealthService`. `resolve_thresholds` merges a stored override over the defaults so a partial or malformed override only costs the cutoffs it got wrong. The sync path currently passes no override, so scoring runs against the shipped defaults.
- `health_status` is `unknown` until a repo has been synced.

### LLM Integration
- All LLM calls go through the abstract `LLMService` interface in `app/services/llm/base.py`. `get_llm_service` in `app/services/llm/__init__.py` picks the adapter — Anthropic, or Ollama for a locally-running model.
- **The provider, model and API key are instance-wide and admin-only**, held in the single `llm_config` row (`app/models/llm_config.py`). Users do not supply their own key. `get_llm_config` creates that row on first read from `settings.DEFAULT_LLM_*`, so a fresh install works with nothing configured; the Anthropic adapter falls back to the `ANTHROPIC_API_KEY` env var when no key is stored.
- `resolve_llm_settings(db, user_id)` is the one way to get a request's LLM config. It reads the instance config plus that user's `commit_evaluation_criteria` — the rubric is the only per-user LLM setting left on `AppSettings`.
- **Every LLM entry point must call `require_quota(db, user)` before building the adapter, and `record_usage(...)` after.** A quota enforced at some entry points is no quota — the unguarded one becomes the way around it. `QuotaExceeded` is translated into the 429 envelope by a handler in `main.py`, so routes need no try/except.
- Token counts come from what the provider reported, accumulated on the adapter's `usage`. Never estimate: `LlmUsage` in `app/schemas/admin.py` documents why an invented figure is worse than none.
- Limits are per calendar month (UTC), resolved as: admins are unmetered → `users.monthly_token_limit` when not NULL (0 means no access) → `llm_config.default_monthly_token_limit`.
- **Cost is priced from admin-entered rates only** (`llm_config.input/output_price_per_mtok`, `Numeric` not float). No built-in price table — it would go stale silently. Both rates NULL means cost is reported as *unavailable*, never as `$0.00`, which would call a month of real spend free.
- The admin panel has three tabs: Overview, Users, and one AI tab, `AiSettingsTab`. There is no LLM Usage tab: the token-and-cost report sits at the bottom of AI Settings beside the rates it is priced at, and call volume over time is the Overview tab's `LlmVolumeCard`. `/admin/llm-usage` still backs that card — do not delete it.
- Summary prompts are defined as templates in the `SummaryService`, not in the adapter. Three types: `repo_overview`, `contributor_activity`, `health_explanation`.
- Store all generated summaries in the `Summary` table with model name and timestamp. Per-commit classifications are cached in `commit_classifications`, keyed by `(repo_id, commit_hash)`, so a commit costs a call once.
- Do not call the LLM during tests. Mock the `LLMService` interface in test fixtures. The one suite that hits a real API is marked `llm` and deselected by default.

### Git & GitHub Operations
- All git operations use GitPython and operate on local clones.
- Clones live under `{REPO_ROOT_DIR}/{collection.local_folder_name}/{repo-name}/`.
- `git_service.py` is the single point of contact for all git operations. No other service or route should shell out to git or use GitPython directly.
- Clone with full history (not shallow) so commit analysis has complete data.
- Parse git log to extract: commit hash, author name, author email, date, message, branch, insertions, deletions, files changed.
- Sync is always user-initiated — per repo or across a collection. There is no scheduler and no background cron; do not add one without saying so here.
- Removing a repo deletes its tracked records (`repo_removal_service.py`) and deliberately leaves the clone on disk and the GitHub repository untouched.
- Commits are **not** persisted as the source of truth — they are re-parsed from the clone on each sync. `commit_snapshot_service` stores a copy so the UI degrades to "what we last saw" instead of an empty table when a clone is unreadable; nothing reads it while the clone is readable.
- The GitHub REST API is used for **pull requests only** (`github_service.py`). Everything else comes from the clone.
- **Authentication is per-user, not per-instance.** Clone, fetch and PR sync all use the signed-in user's `users.github_token`; without one, adding a repo and syncing PRs return 403. The `GITHUB_TOKEN` env var is *not* a fallback — it is read in exactly one place, `admin_stats_service`, to show "configured" on the admin System card. Do not write code or docs that assume it authenticates anything.

### Notifications
- Raise notifications through `notification_service.notify`, never by inserting rows. It resolves recipients from collection access and honours per-user subscriptions.
- Types are the `NotificationType` enum: `mention`, `note_comment`, `reminder` (note-scoped, text derived from the note) and `repo_added`, `repo_removed`, `repo_health_declined`, `pr_opened`, `pr_merged` (repo-scoped, carrying their own subject/body).
- Unsubscribing **suppresses creation** rather than hiding an existing row. A user who has never edited preferences receives everything, so a type added later reaches people rather than being silently withheld.
- Notes and notifications soft-delete (`deleted_at`) into a Recently deleted list. Filter deleted rows out of every listing.

### Docker & Local Dev
- `docker compose up` starts four services: frontend, backend, db, and phoenix.
- Frontend: Vite dev server with hot reload on port 5173, proxying `/api` to the backend.
- Backend: Uvicorn with `--reload` on port 8000.
- Database: `postgres:16-alpine` on port 5432 with a named volume for persistence. `db/init/` runs only on a fresh volume.
- Phoenix: `arizephoenix/phoenix` on port 6006, receiving OTLP traces of LLM calls. Tracing initializes only when `OTEL_EXPORTER_OTLP_ENDPOINT` is set.
- `/healthz` probes the database and reports the schema revision, returning 503 when unreachable or unmigrated. It shares its probe with `GET /api/v1/admin/system` so the two cannot disagree.
- The repo root directory is bind-mounted from the host into the backend container so GitPython can access clones. `local_path` is a container path, never a host one, so no user-facing feature may treat it as a path on the viewer's machine — the "Open in VS Code" button opens VS Code for the Web against GitHub instead (see `frontend/src/lib/vscodeUrl.ts`).
- `REPO_ROOT_DIR` must be absolute and must match the container side of the bind mount (`/repos`). The backend refuses to start otherwise: a relative path resolves against `/app` and clones are lost on the next rebuild.
- `.env` at project root contains: `DATABASE_URL`, `TEST_DATABASE_URL`, `SECRET_KEY`, `AUTH_MODE`, `REPO_ROOT_DIR`, `ANTHROPIC_API_KEY`, `GITHUB_TOKEN`.

## Running Tests
```bash
# All tests (backend + frontend + landing)
make test

# Backend only
make test-backend
# or: docker compose exec backend pytest -v

# Create the test database — needed once on a pre-existing postgres volume
make test-db

# Import/startup smoke tests, no database needed
make test-smoke

# The migration checks CI gates a merge on
make test-migrations

# Frontend only
make test-frontend
# or: docker compose exec frontend npx vitest run

# Landing page + product tour (static documents, no stack needed)
make test-landing
# or: node --test tests/*.test.cjs

# Frontend watch mode
make test-watch
# or: docker compose exec frontend npx vitest

# Tests that hit a real LLM API — deselected by default, needs a real key
docker compose exec backend pytest -m llm -v
```

## Bootstrapping an Instance
A fresh database has no users, and `POST /api/v1/users` is admin-gated, so the first administrator is created from the command line:

```bash
ADMIN_EMAIL=you@example.com make seed-admin
# or: docker compose exec -e ADMIN_EMAIL backend python -m app.db.seed_admin
```

Omitting `ADMIN_PASSWORD` prints a one-time `/account-setup` link instead of setting one. Re-running promotes an existing account, which is the recovery path for a locked-out admin. Everyone else is invited from the admin panel's Users tab.

**`make seed` is currently inert.** `backend/app/db/seed.py` is commented out in full — the mock users, collections and synthetic repo histories it used to create were deliberately retired. Do not assume seeded demo data exists; do not write tests or docs that depend on it. If mock data is needed again, restore that script rather than inventing a second one.

## Where Things Live
The original build order in `PRD.md` §9.1 is complete. To find current work:

| Area | Backend | Frontend |
|---|---|---|
| Auth, account setup | `routes/auth.py`, `services/account_setup_service.py` | `pages/LoginPage.tsx`, `pages/AccountSetupPage.tsx` |
| Collections, sharing | `routes/collections.py`, `routes/collection_access.py` | `pages/CollectionsPage.tsx`, `pages/CollectionDetailPage.tsx` |
| Repos, sync, health | `routes/repos.py`, `services/git_service.py`, `services/health_service.py` | `pages/RepoDetailPage.tsx`, `components/HealthBadge.tsx` |
| Contributors, aliases | `routes/contributors.py`, `services/contributor_service.py` | `components/` under Repo Detail |
| Commits, classification | `routes/commit_classification.py`, `routes/commit_quality.py` | `components/CommitQualityPanel.tsx`, `components/CommitScorePill.tsx` |
| Pull requests | `routes/pull_requests.py`, `services/github_service.py` | Repo Detail PR panel |
| Notes, comments, reminders | `routes/notes.py`, `routes/note_comments.py` | `components/NotesDrawer.tsx`, `components/NoteForm.tsx` |
| Notifications | `routes/notifications.py`, `services/notification_service.py` | `pages/NotificationsPage.tsx`, `components/NotificationIcon.tsx` |
| Summaries | `routes/summaries.py`, `services/summary_service.py` | `hooks/useSummaries.ts` |
| Settings | `routes/settings.py` | `pages/SettingsPage.tsx`, `pages/UserProfilePage.tsx` |
| Admin | `routes/admin.py`, `routes/users.py`, `services/admin_stats_service.py` | `pages/AdminPage.tsx`, `components/admin/` |
