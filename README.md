# RepoPulse

A local-first web app for monitoring student GitHub project repositories. Provides health dashboards, contributor analytics, AI-generated summaries, and note-taking — all powered by local git clones.

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + Vite + TypeScript + Tailwind CSS + shadcn/ui + Framer Motion |
| Backend | FastAPI (Python 3.11) + SQLAlchemy 2.0 async + Alembic |
| Database | PostgreSQL 16 |
| Git ops | GitPython |
| AI | Anthropic SDK |
| Charts | Recharts |
| Data fetching | Tanstack Query |

## Quick Start

### 1. Configure environment

```bash
cp .env.example .env
# Add your ANTHROPIC_API_KEY to .env (optional — only needed for AI summaries)
```

### 2. Start all services

```bash
make build   # first run only
make up
```

- Frontend: http://localhost:5173
- Backend API: http://localhost:8000
- API docs: http://localhost:8000/docs

The backend applies `alembic upgrade head` before the server starts, so the
schema is ready on first boot — there is no separate setup step. Check it with
`curl localhost:8000/healthz`, which reports the current schema revision and
returns 503 if the database is unreachable or unmigrated.

### 3. Seed the database

```bash
make seed
```

Creates mock users, collections, repos with varied health profiles, contributors, notes, and pre-generated summaries. The dashboard is fully functional after seeding — no real GitHub repos needed.

### 4. Log in

In dev mode, click any of the three user cards on the login screen.

## Development

```bash
make test           # run all tests (backend + frontend)
make test-backend   # backend tests only
make test-db        # create the test database (see note below)
make test-smoke     # fast import/startup smoke tests (no DB needed)
make test-frontend  # frontend tests only
make test-watch     # frontend tests in watch mode

make seed           # seed the database with mock data (schema must exist)
make migrate        # apply a new migration to an already-running stack
make migration MSG="describe change"  # generate a new migration

make shell-backend  # bash shell in backend container
make shell-db       # psql shell in database container
make logs           # tail all container logs
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

## Project Structure

```
repo-pulse/
├── docker-compose.yml
├── .env.example           # copy to .env
├── Makefile
├── frontend/
│   ├── src/
│   │   ├── components/    # shared components (+ ui/ for shadcn)
│   │   ├── pages/         # one file per route
│   │   ├── hooks/         # Tanstack Query hooks
│   │   ├── services/      # typed API client
│   │   └── types/         # TypeScript interfaces
│   └── package.json
├── backend/
│   ├── app/
│   │   ├── api/routes/    # FastAPI routers (thin — validate + call service)
│   │   ├── models/        # SQLAlchemy models
│   │   ├── schemas/       # Pydantic request/response schemas
│   │   ├── services/      # business logic (git, health, LLM, summary)
│   │   ├── db/            # database setup, Alembic migrations, seed script
│   │   └── core/          # config, auth, dependencies
│   ├── tests/
│   └── requirements.txt
└── seed-repos/            # local git clones (bind-mounted into backend container)
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
- **All LLM calls** go through the abstract `LLMService` interface.

## Auth

Set `AUTH_MODE=dev` in `.env` (the default) to use the click-to-login dev cards.
Set `AUTH_MODE=prod` to require email + password.

The API uses JWT Bearer tokens. Get a token from `POST /api/v1/auth/dev-login` or `POST /api/v1/auth/login`, then pass it as `Authorization: Bearer <token>`.
