# CLAUDE.md — RepoPulse

## Project Overview
RepoPulse is a local-first web app for monitoring student GitHub project repositories. It provides health dashboards, contributor analytics, AI-generated summaries, and note-taking — all powered by local git clones. See `PRD.md` for full product requirements.

## Tech Stack
- **Frontend:** React 18 + Vite + TypeScript + Tailwind CSS + shadcn/ui + Framer Motion
- **Backend:** FastAPI (Python 3.11+) + SQLAlchemy 2.0 (async) + asyncpg + Alembic
- **Database:** PostgreSQL 16 (Docker container)
- **Git operations:** GitPython
- **LLM:** Anthropic SDK (provider-abstracted)
- **Charts:** Recharts
- **Data fetching:** Tanstack Query (React Query)
- **Testing:** pytest + pytest-asyncio + httpx (backend), Vitest + React Testing Library + MSW (frontend)
- **Containerization:** Docker Compose (3 services: frontend, backend, db)

## Project Structure
```
repo-pulse/
├── docker-compose.yml
├── frontend/
│   ├── Dockerfile
│   ├── src/
│   │   ├── components/
│   │   │   └── ui/            # shadcn components
│   │   ├── pages/
│   │   ├── hooks/
│   │   ├── services/          # API client
│   │   ├── lib/               # utilities
│   │   └── types/
│   ├── package.json
│   └── vite.config.ts
├── backend/
│   ├── Dockerfile
│   ├── app/
│   │   ├── api/
│   │   │   └── routes/        # FastAPI routers
│   │   ├── models/            # SQLAlchemy models
│   │   ├── schemas/           # Pydantic request/response schemas
│   │   ├── services/          # Business logic layer
│   │   │   ├── git_service.py
│   │   │   ├── health_service.py
│   │   │   ├── llm/
│   │   │   │   ├── base.py            # Abstract LLMService interface
│   │   │   │   ├── anthropic_adapter.py
│   │   │   │   └── __init__.py
│   │   │   └── summary_service.py
│   │   ├── db/
│   │   │   ├── database.py
│   │   │   ├── seed.py
│   │   │   └── migrations/    # Alembic
│   │   ├── core/
│   │   │   ├── config.py      # Pydantic Settings
│   │   │   ├── auth.py
│   │   │   └── deps.py        # FastAPI dependencies
│   │   └── main.py
│   ├── tests/
│   │   ├── conftest.py        # Fixtures: test db, test client, mock repos
│   │   ├── api/
│   │   ├── services/
│   │   └── factories/         # Test data factories
│   ├── requirements.txt
│   └── alembic.ini
├── .claude/
│   ├── settings.json
│   └── agents/
├── CLAUDE.md
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
- **All errors** return `{"detail": "...", "error_code": "..."}` with appropriate HTTP status codes.
- **Auth** is JWT-based, via `Authorization: Bearer <token>` header. In dev mode (`AUTH_MODE=dev`), the login endpoint accepts a mock user ID without a password.
- **Config** uses Pydantic `BaseSettings` reading from environment variables.
- **Imports** within the backend always use absolute paths from `app.` (e.g., `from app.models.repo import Repo`).
- **Service layer** is where business logic lives. Routes should be thin — validate input, call a service, return a response.

### Frontend Conventions
- **shadcn/ui** components go in `src/components/ui/`. Custom components go in `src/components/`.
- **Pages** go in `src/pages/` and correspond to routes.
- **API calls** go through a typed API client in `src/services/api.ts`. Never call `fetch` directly from components.
- **All data fetching** uses Tanstack Query hooks (in `src/hooks/`).
- **Animations** use Framer Motion. Add entrance animations to page transitions and card layouts. Use `AnimatePresence` for route transitions.
- **Tailwind only** — no inline styles, no CSS modules, no styled-components.
- **TypeScript strict mode** — no `any` types. Define all types in `src/types/`.

### Database & ORM
- SQLAlchemy models define the schema. Alembic manages migrations.
- When changing models, always generate and review a migration: `alembic revision --autogenerate -m "description"`.
- The schema is designed for future PostgreSQL/Supabase compatibility — it is already PostgreSQL. Do not use SQLite-specific features.
- Use `relationship()` with `lazy="selectin"` as the default loading strategy to avoid N+1 queries.

### LLM Integration
- All LLM calls go through the abstract `LLMService` interface in `app/services/llm/base.py`.
- The Anthropic adapter reads the API key from `ANTHROPIC_API_KEY` env var and the model from the user's `AppSettings`.
- Summary prompts are defined as templates in the `SummaryService`, not in the adapter.
- Store all generated summaries in the `Summary` table with model name and timestamp.
- Do not call the LLM during tests. Mock the `LLMService` interface in test fixtures.

### Git Operations
- All git operations use GitPython and operate on local clones.
- Clones live under `{REPO_ROOT_DIR}/{collection.local_folder_name}/{repo-name}/`.
- `git_service.py` is the single point of contact for all git operations. No other service or route should shell out to git or use GitPython directly.
- Clone with full history (not shallow) so commit analysis has complete data.
- Parse git log to extract: commit hash, author name, author email, date, message, branch, insertions, deletions, files changed.

### Docker & Local Dev
- `docker compose up` starts all three services (frontend, backend, db).
- Frontend: Vite dev server with hot reload on port 5173.
- Backend: Uvicorn with `--reload` on port 8000.
- Database: `postgres:16-alpine` on port 5432 with a named volume for persistence.
- The repo root directory is bind-mounted from the host into the backend container so GitPython can access clones and the VS Code URI scheme still works on the host.
- `.env` at project root contains: `DATABASE_URL`, `ANTHROPIC_API_KEY`, `AUTH_MODE`, `REPO_ROOT_DIR`.

## Running Tests
```bash
# All tests
make test

# Backend only
make test-backend
# or: docker compose exec backend pytest -v

# Frontend only
make test-frontend
# or: docker compose exec frontend npx vitest run

# Frontend watch mode
make test-watch
# or: docker compose exec frontend npx vitest
```

## Seeding the Database
```bash
make seed
# or: docker compose exec backend python -m app.db.seed
```
This creates mock users, collections, repos (with synthetic git histories), contributors, notes, and pre-generated summaries. The dashboard should be fully functional after seeding without any external dependencies.

## Build Order
Follow this sequence. Each step should have passing tests before moving to the next.

1. Project scaffolding: Docker Compose, Vite, FastAPI, SQLAlchemy models, Alembic init
2. Auth: User model, dev-login endpoint, mock users, JWT middleware
3. Collections CRUD: API + frontend pages
4. Repos CRUD: Add repos by URL, display in collection view
5. Git operations: Clone and fetch via GitPython, wire to API
6. Commit parsing & contributor discovery: Parse git log, create Contributors and Aliases
7. Health scoring: Implement all 5 signals, composite score, store on Repo
8. Collection dashboard UI: Repo cards, health badges, sparklines, action buttons
9. Repo detail view: Tabs for overview, contributors, commits, notes
10. Alias merge UI
11. Notes & reminders: CRUD + display
12. GenAI integration: LLM service interface, Anthropic adapter, summary generation
13. Settings page
14. Polish: Loading states, error handling, empty states, animations
