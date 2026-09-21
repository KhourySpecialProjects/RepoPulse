# RepoPulse

A web app for monitoring student GitHub project repositories. Health dashboards,
contributor analytics, commit-quality scoring, pull-request tracking, shared
notes and reminders, and AI-generated summaries — all computed from local git
clones rather than the GitHub UI.

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + Vite + TypeScript + Tailwind CSS + shadcn/ui + Framer Motion |
| Backend | FastAPI (Python 3.11) + SQLAlchemy 2.0 async + asyncpg + Alembic |
| Database | PostgreSQL 16 |
| Git ops | GitPython (local clones) + GitHub REST API (pull requests only) |
| AI | Anthropic SDK, or a local Ollama server |
| Tracing | Arize Phoenix over OpenTelemetry (opt-in) |
| Charts | Recharts |
| Data fetching | Tanstack Query |

## Quick Start

### 1. Configure environment

```bash
cp .env.example .env
```

Nothing in `.env` is required to boot. Fill in what you need:

| Variable | Needed for |
|---|---|
| `DATABASE_URL` / `TEST_DATABASE_URL` | Already correct for Docker Compose |
| `SECRET_KEY` | JWT signing — change it for anything but local dev |
| `AUTH_MODE` | `dev` enables `POST /api/v1/auth/dev-login`; `prod` disables it |
| `REPO_ROOT_DIR` | Clone root **inside the container** (`/repos`). Must be absolute — the backend refuses to start otherwise |
| `ANTHROPIC_API_KEY` | AI summaries and commit scoring, unless an admin sets a key in the admin panel |
| `GITHUB_TOKEN` | Only read to show "configured" on the admin System card. Clone, fetch and PR sync use the **signed-in user's** token, set on the Settings page — there is no env fallback, and adding a repo without one returns 403 |

### 2. Start the services

```bash
make build   # first run only
make up
```

- Frontend: http://localhost:5173
- Backend API: http://localhost:8000
- API docs: http://localhost:8000/docs
- Phoenix (LLM traces): http://localhost:6006

The backend applies `alembic upgrade head` before the server starts, so the
schema is ready on first boot — there is no separate setup step. Check it with
`curl localhost:8000/healthz`, which reports the current schema revision and
returns 503 if the database is unreachable or unmigrated.

### 3. Create the first administrator

There is no mock data and no click-to-login user cards. A fresh database has no
users at all, and `POST /api/v1/users` is admin-gated, so the first account is
bootstrapped from the command line:

```bash
ADMIN_EMAIL=you@example.com make seed-admin
```

Omit `ADMIN_PASSWORD` and the script prints a one-time `/account-setup` link for
choosing a password. Pass `ADMIN_PASSWORD='...'` to set one directly. Re-running
it promotes an existing account, which is the recovery path for a locked-out
admin. Everyone else is invited from the admin panel's Users tab, which mints
the same kind of setup link.

> `make seed` still exists but is currently inert — the mock-data seed script
> (`backend/app/db/seed.py`) is commented out in full. Seeded demo repos are not
> part of the current workflow; add real repositories by URL instead.

### 4. Sign in

Email and password at `/login`. Signed out, `/` serves the static landing page
(`frontend/public/landing.html`) instead; signed in, it is the dashboard.

## Development

```bash
make test           # backend + frontend + landing
make test-backend   # backend tests only (needs the test database, below)
make test-db        # create the test database (see note below)
make test-smoke     # fast import/startup smoke tests (no DB needed)
make test-migrations # the same migration checks CI gates a merge on
make test-frontend  # frontend tests only
make test-landing   # landing page + product tour; no stack, no browser
make test-watch     # frontend tests in watch mode

make seed-admin     # bootstrap or promote an administrator (ADMIN_EMAIL=...)
make migrate        # apply migrations to an already-running stack
make migration MSG="describe change"  # generate a new migration

make shell-backend  # bash shell in backend container
make shell-db       # psql shell in database container
make logs           # tail all container logs
```

Tests that hit a real LLM API are marked `llm` and deselected by default. Run
them deliberately, with a real key:

```bash
docker compose exec backend pytest -m llm -v
```

### The test database

The backend suite connects to a separate `repopulse_test` database, not the
`repopulse` one the app uses. `db/init/01-create-test-db.sql` creates it
automatically — but Postgres only runs `/docker-entrypoint-initdb.d/` scripts
when the data directory is empty, so that covers a **fresh** `postgres_data`
volume only.

If you already had a volume before this script existed, create it once:

```bash
make test-db
```

Without it, every DB-backed test errors at fixture setup with
`asyncpg.exceptions.InvalidCatalogNameError: database "repopulse_test" does not exist`.

### Continuous integration

`.github/workflows/migrations.yml` runs on every push and PR to `main` and `dev`. It
gates a merge on the migration chain only: the chain applies to an empty
database, the result matches the models, there is exactly one head, and
`upgrade head → downgrade base → upgrade head` round-trips.

## What the app does

- **Collections** group repos by course or semester, with per-collection sharing
  (owner, co-instructor, TA) and archiving.
- **Repos** are cloned in full (never shallow) under
  `{REPO_ROOT_DIR}/{collection_folder}/{repo_name}/`. Sync is always
  user-initiated: per repo, or across a whole collection.
- **Health** scores six signals — commit frequency, recency, distribution
  (Gini), branch activity, commit-message quality, and participation against an
  expected contributor count — into a `green`/`yellow`/`red`/`unknown` badge.
- **Contributors** are discovered from git log; multiple email/name identities
  can be merged into one person and unmerged again.
- **Commits** are parsed live from the clone, with a database snapshot so the
  UI degrades to "what we last saw" rather than an empty table when a clone is
  missing. An LLM can classify each commit as substantive or logistical and
  score its quality, cached per commit hash.
- **Pull requests** are fetched from the GitHub API per repo, with review and
  merge stats.
- **Notes and reminders** attach to a repo, a contributor, or a commit, support
  comments and `@`-mentions, can be shared with other users, and soft-delete
  into a Recently deleted list.
- **Notifications** cover mentions, comments, due reminders, repos added or
  removed, health declines, and PRs opened or merged — each mutable per user.
- **AI summaries** (repo overview, contributor activity, health explanation) are
  stored with the model that wrote them.
- **Admin panel** (`/admin`) has three tabs: Overview (coverage, storage, sync
  health, LLM call volume, faults needing attention), Users, and AI Settings
  (instance-wide provider/model/key, token limits, prices, and the usage report).

## Project Structure

```
repo-pulse/
├── docker-compose.yml     # frontend, backend, db, phoenix
├── .env.example           # copy to .env
├── Makefile
├── db/init/               # runs once on a fresh postgres volume
├── seed-repos/            # clone root, bind-mounted into the backend as /repos
├── tests/                 # landing page + product tour (node --test)
├── docs/plans/            # design notes for larger changes
├── frontend/
│   ├── public/            # landing.html, tour.html — static, served verbatim
│   ├── src/
│   │   ├── components/    # shared components (+ ui/ for shadcn, admin/, charts/, dashboard/)
│   │   ├── pages/         # one file per route
│   │   ├── hooks/         # Tanstack Query hooks
│   │   ├── services/      # typed API client
│   │   ├── lib/           # utilities
│   │   ├── types/         # TypeScript interfaces
│   │   ├── mocks/         # MSW handlers
│   │   └── __tests__/     # Vitest
│   └── package.json
├── backend/
│   ├── entrypoint.sh      # alembic upgrade head, then uvicorn
│   ├── app/
│   │   ├── api/routes/    # FastAPI routers (thin — validate + call service)
│   │   ├── models/        # SQLAlchemy models
│   │   ├── schemas/       # Pydantic request/response schemas
│   │   ├── services/      # business logic (git, github, health, llm/, summary, …)
│   │   ├── db/            # database setup, Alembic migrations, seed scripts
│   │   └── core/          # config, auth, dependencies, errors
│   ├── scripts/           # offline tools (classifier eval, commit harvesting)
│   ├── tests/
│   └── requirements.txt
└── CLAUDE.md              # conventions for agents working in this repo
```

## Key Conventions

- **TDD** — tests are written before implementation.
- **Alembic owns the schema.** Nothing calls `Base.metadata.create_all` except
  the test fixtures. Change a model, generate a migration, and
  `tests/test_migrations.py` will fail if the two disagree.
- **All API routes** are prefixed `/api/v1/`. Auth routes are `/api/v1/auth/`.
- **All endpoints** use Pydantic schemas — no raw dicts.
- **List endpoints** return `{"items": [...], "total": int, "limit": int, "offset": int}`.
- **Errors** return `{"detail": "...", "error_code": "..."}`.
- **All git operations** go through `git_service.py` only.
- **All LLM calls** go through the abstract `LLMService` interface, behind a
  per-user monthly token quota.

See `CLAUDE.md` for the full set.

## Auth & roles

The API uses JWT Bearer tokens. Get one from `POST /api/v1/auth/login`, then
pass it as `Authorization: Bearer <token>`.

`AUTH_MODE=dev` additionally enables `POST /api/v1/auth/dev-login`, which issues
a token for any existing user id without a password. It is an API affordance for
development, not a UI one — the login screen asks for a password in both modes.
Set `AUTH_MODE=prod` to disable it.

Two role systems stack:

- **Instance role** on the user — `instructor`, `ta`, or `admin`. Admins reach
  `/api/v1/admin/*`, manage users, and are never metered for LLM tokens.
- **Collection role** — the owner, plus `co_instructor` and `ta` grants in
  `collection_access`. Instance admins have owner power everywhere.
  `app/services/permission_service.py` resolves both.

## Observability

Set `OTEL_EXPORTER_OTLP_ENDPOINT` and the backend instruments Anthropic calls
and exports traces. Compose points it at the bundled Phoenix service, so LLM
prompts and responses are inspectable at http://localhost:6006. Leave the
variable unset and tracing never initializes.
