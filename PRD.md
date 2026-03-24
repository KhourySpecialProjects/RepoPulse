# RepoPulse v1.0 — Product Requirements Document

**Author:** Mark (Khoury College, Northeastern University)
**Date:** March 21, 2026
**Target:** Working prototype by end of day

---

## 1. Problem Statement

Monitoring student team GitHub repositories across courses is painful. GitHub's UI requires too many clicks when navigating across orgs, GitHub Classroom is slow, and there's no consolidated view that answers the key teaching question: *which teams are progressing, which are struggling, and which students are contributing?*

**RepoPulse** is a local-first web app that gives an instructor a real-time dashboard over a semester's worth of student project repos, with health indicators, contributor analytics, AI-generated summaries, and personal note-taking — all without fighting GitHub's UI.

---

## 2. Users & Auth

- **v1 user:** Single user (the instructor). The app should be architected for multi-user support (TAs, co-instructors) but v1 only needs one real user.
- **Auth model:** Email/password authentication with proper schema and API structure. For development, the login screen presents 2–3 mock user profiles to click into (no password entry needed in dev mode). The mock/real toggle should be controlled via environment variable.
- **User model fields:** `id`, `email`, `password_hash`, `display_name`, `role` (enum: `instructor`, `ta`, `admin`), `created_at`, `updated_at`.

---

## 3. Core Concepts & Data Model

### 3.1 Collection
A named group of repos. The primary organizational unit.

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `name` | string | e.g., "Spring 2026 DB Projects" |
| `course_tag` | string (nullable) | e.g., "CS 3200" |
| `semester_tag` | string (nullable) | e.g., "Spring 2026" |
| `local_folder_name` | string | Subfolder name within the app-managed root directory |
| `owner_id` | FK → User | |
| `created_at` | datetime | |
| `updated_at` | datetime | |

### 3.2 Repo
A tracked GitHub repository, belonging to a collection.

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `collection_id` | FK → Collection | |
| `github_url` | string | Full HTTPS URL |
| `name` | string | Derived from URL or user-provided |
| `local_path` | string | Absolute path to local clone |
| `health_status` | enum | `green`, `yellow`, `red`, `unknown` |
| `health_score` | JSON | Breakdown of individual signal scores |
| `last_synced_at` | datetime (nullable) | Last successful git fetch |
| `created_at` | datetime | |
| `updated_at` | datetime | |

### 3.3 Contributor
A person identity, potentially merging multiple git email/name combos.

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `display_name` | string | User-editable |
| `repo_id` | FK → Repo | A contributor is scoped to a repo |
| `created_at` | datetime | |

### 3.4 ContributorAlias
Maps raw git author identities to a Contributor.

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `contributor_id` | FK → Contributor | |
| `git_email` | string | |
| `git_name` | string | |

### 3.5 Note
Attached to a repo, a contributor, or global (scratchpad).

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `author_id` | FK → User | |
| `repo_id` | FK → Repo (nullable) | |
| `contributor_id` | FK → Contributor (nullable) | |
| `content` | text | Markdown supported |
| `is_reminder` | boolean | If true, surface in UI as a reminder |
| `reminder_context` | text (nullable) | e.g., "Check if Sarah has started committing" |
| `created_at` | datetime | |
| `updated_at` | datetime | |

**Scope logic:** If both `repo_id` and `contributor_id` are null → global scratchpad note. If `repo_id` is set but `contributor_id` is null → repo-level note. If both are set → contributor-level note.

### 3.6 Summary
AI-generated summary, stored for reference.

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `repo_id` | FK → Repo (nullable) | |
| `contributor_id` | FK → Contributor (nullable) | |
| `summary_type` | enum | `repo_overview`, `contributor_activity`, `health_explanation` |
| `content` | text | |
| `model_used` | string | e.g., "claude-sonnet-4-20250514" |
| `generated_at` | datetime | |

### 3.7 AppSettings (singleton or keyed per-user)

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `user_id` | FK → User | |
| `repo_root_directory` | string | e.g., `~/repo-monitor/` |
| `llm_provider` | string | Default: `anthropic` |
| `llm_model` | string | Default: `claude-sonnet-4-20250514` |
| `health_thresholds` | JSON | Default thresholds for all signals (see §5) |

---

## 4. Directory & Clone Management

### 4.1 Structure
```
{repo_root_directory}/           ← configured in AppSettings
├── {collection.local_folder_name}/
│   ├── {repo-name-1}/           ← git clone
│   ├── {repo-name-2}/
├── {another-collection-folder}/
│   └── ...
```

### 4.2 Operations
- **Add repo:** When a GitHub URL is pasted into a collection, the backend clones it into the appropriate collection folder. The clone is a full clone (not shallow) so that complete history is available.
- **Sync (fetch/pull):** A "Sync" button at the collection level runs `git fetch --all` across all repos in the collection. A per-repo sync button also exists. Sync is always user-initiated (no background cron in v1).
- **Rate limits:** Since all analysis runs against local clones, GitHub API is only hit during clone and fetch operations. With ≤30 repos, this is well within rate limits. No GitHub API calls are needed for commit analysis.

---

## 5. Health Signals & Scoring

Each repo gets a composite health status (`green`, `yellow`, `red`) derived from five weighted signals. All analysis runs against the local git data.

### 5.1 Signals

| Signal | What it measures | Green | Yellow | Red |
|---|---|---|---|---|
| **Commit frequency** | Commits per week (team-wide) | ≥10/week | 4–9/week | ≤3/week |
| **Recency** | Time since last commit | <3 days | 3–7 days | >7 days |
| **Distribution** | Gini coefficient of commits across contributors | Gini <0.35 | 0.35–0.60 | >0.60 |
| **Branch activity** | Number of active branches; evidence of feature-branch workflow | ≥2 active branches | 1 branch with recent activity | All commits on main/single branch, no branching |
| **Commit message quality** | Average message length; flags single-word or empty messages | <10% low-quality | 10–30% low-quality | >30% low-quality |

### 5.2 Composite Score
- Each signal scores 0 (red), 1 (yellow), or 2 (green).
- Composite = weighted average (equal weights for v1).
- Composite ≥ 1.5 → **Green**, 0.75–1.49 → **Yellow**, < 0.75 → **Red**.
- All thresholds stored in `AppSettings.health_thresholds` as JSON for future configurability.

### 5.3 Staleness
Health status shows as `unknown` if the repo has never been synced or if the last sync was more than 7 days ago (visual indicator that data may be stale).

---

## 6. Screens & UI

### 6.1 Login Screen
- Dev mode: Displays 2–3 mock user cards to click into.
- Prod mode: Standard email/password form.
- Controlled by `AUTH_MODE=dev|prod` env var.

### 6.2 Home / Collections List
- List of all collections with name, course/semester tags, repo count, and a mini health summary (e.g., "8 green, 2 yellow, 1 red").
- "New Collection" button → name, folder name, optional course/semester tags.
- Access to global scratchpad.
- App settings link.

### 6.3 Collection Dashboard
The primary working screen.

- **Header:** Collection name, tags, sync all button, "Add Repo(s)" button.
- **Repo cards** in a grid or list layout, each showing:
  - Repo name
  - Health status badge (colored dot or pill: green/yellow/red/grey)
  - Contributor count (prominent)
  - Last commit date
  - Quick-stat sparkline or mini bar chart (commits over last 4 weeks)
  - Buttons: "GitHub" (opens repo on github.com), "VS Code" (opens via `vscode://file/{local_path}`), "Details"
  - Any active reminders for this repo shown as a small indicator/badge
- **Sorting/filtering:** By health status, last activity, name.
- **Bulk actions:** Sync all, generate all summaries.

### 6.4 Repo Detail View
Deep dive into a single repo.

- **Header:** Repo name, health status (with breakdown of all 5 signals), GitHub link, VS Code link, sync button.
- **Tabs or sections:**
  1. **Overview:** AI-generated repo summary (on-demand button), commit timeline chart (commits over time, optionally split by contributor), branch visualization (active branches, recent merges).
  2. **Contributors:** List of all contributors with:
     - Display name (editable)
     - Commit count, lines added/removed, last commit date
     - Quantitative contribution breakdown (% of total commits, % of lines changed)
     - "Generate Summary" button → AI summary of this person's recent contributions
     - Email alias indicator — if multiple aliases detected, show merge UI
     - Per-contributor notes & reminders
  3. **Commit History:** Chronological commit log (all branches), with author, date, message, branch, and diff stats (+/-). Filterable by contributor, branch, date range.
  4. **Notes & Reminders:** All notes for this repo. Add new note/reminder form. Reminders surfaced at the top.

### 6.5 Contributor Alias Merge UI
Accessed from the Contributors section of the Repo Detail View.

- Shows all detected git email/name combinations.
- Each is initially auto-assigned to a Contributor identity.
- User can select multiple aliases and merge them into one Contributor via checkboxes + "Merge" button.
- Merged identity uses a user-editable display name.

### 6.6 Settings Page
- **App root directory:** File path for clone management.
- **LLM configuration:** Provider (read-only for v1: "Anthropic"), model selector (dropdown of available models: `claude-sonnet-4-20250514`, `claude-haiku-4-5-20251001`, etc.), API key status indicator.
- **Health thresholds:** Display current thresholds (read-only for v1, editable in v1.1).

---

## 7. GenAI Integration

### 7.1 Architecture
- **LLM Service Interface:** An abstract `LLMService` class with a `generate(prompt, context) → str` method.
- **Anthropic Adapter:** Implements `LLMService` using the Anthropic SDK. Reads API key from `ANTHROPIC_API_KEY` env var. Model selected from `AppSettings.llm_model`.
- Future adapters (OpenAI, local models) implement the same interface.

### 7.2 Summary Types

| Type | Trigger | Input Context | Output |
|---|---|---|---|
| **Repo Overview** | On-demand button on repo detail | Recent commit messages, contributor stats, branch info, health scores | 2–3 paragraph summary of project status, activity patterns, notable developments |
| **Contributor Activity** | On-demand button per contributor | That contributor's recent commits (messages, file paths, diffs stats) | Brief paragraph on what this person has been working on, areas of focus, activity level |
| **Health Explanation** | On-demand alongside health badge | All 5 signal scores and raw data | 2–3 sentence plain-English explanation of why the repo is red/yellow/green |

### 7.3 Design Considerations
- Summaries are stored in the `Summary` table with model and timestamp for traceability.
- The prompt construction and the trigger mechanism are decoupled — summary generation goes through a `SummaryService` that calls `LLMService`. This makes it straightforward to add auto-generation triggers later (e.g., post-sync hook).
- Token budget per summary call should be capped and configurable.

---

## 8. Tech Stack & Architecture

### 8.1 Frontend
- **React 18+** with Vite, TypeScript, Tailwind CSS
- **shadcn/ui** component library with a custom color theme (not default zinc — richer accent palette, leveraging health status colors as part of the visual identity)
- **Framer Motion** for page transitions, card entrance animations, status badge effects, and general UI responsiveness
- **React Router** for navigation
- **Recharts** for commit timeline charts, sparklines, and contribution breakdowns
- **Tanstack Query (React Query)** for data fetching and cache management

### 8.2 Backend
- **FastAPI** (Python 3.11+)
- **SQLAlchemy 2.0** (async) as ORM with **asyncpg** driver
- **PostgreSQL 16** in a dedicated container (Supabase-compatible from day one)
- **Alembic** for schema migrations
- **GitPython** for local git operations (clone, fetch, log parsing)
- **Anthropic Python SDK** for LLM calls

### 8.3 Local Development (Docker Compose)
Three-service architecture:
```yaml
services:
  frontend:    # Node/Vite dev server, hot reload, port 5173
  backend:     # FastAPI with uvicorn, hot reload, port 8000
  db:          # postgres:16-alpine, persistent volume, port 5432
```
- **Volumes:** Backend mounts the repo root directory from the host so GitPython can operate on local clones. Postgres data persists via a named volume.
- **Environment:** `.env` file at project root with `DATABASE_URL`, `ANTHROPIC_API_KEY`, `AUTH_MODE`, `REPO_ROOT_DIR` (host path).
- **Note on git clones:** The repos are cloned on the *host filesystem* and bind-mounted into the backend container. This keeps clones accessible for the "Open in VS Code" feature (which uses host-side `vscode://` URIs) while letting the backend container read git data.

### 8.4 Project Structure
```
repo-pulse/
├── docker-compose.yml
├── frontend/
│   ├── Dockerfile
│   ├── src/
│   │   ├── components/
│   │   │   └── ui/         # shadcn components
│   │   ├── pages/
│   │   ├── hooks/
│   │   ├── services/       # API client
│   │   └── types/
│   ├── package.json
│   └── vite.config.ts
├── backend/
│   ├── Dockerfile
│   ├── app/
│   │   ├── api/
│   │   │   └── routes/     # FastAPI routers
│   │   ├── models/         # SQLAlchemy models
│   │   ├── schemas/        # Pydantic request/response schemas
│   │   ├── services/       # Business logic
│   │   │   ├── git_service.py
│   │   │   ├── health_service.py
│   │   │   ├── llm_service.py       # Abstract interface
│   │   │   ├── anthropic_adapter.py  # Anthropic implementation
│   │   │   └── summary_service.py
│   │   ├── db/
│   │   │   ├── database.py
│   │   │   └── migrations/
│   │   └── main.py
│   ├── requirements.txt
│   └── .env
├── CLAUDE.md               # Claude Code project instructions
└── README.md
```

### 8.5 Testing Strategy (TDD)

Development follows test-driven development throughout. Tests must be easy to run via a single command from the project root.

**Backend (pytest):**
- All API endpoints get integration tests against a test Postgres database (separate `db-test` service in docker-compose, or a test database created on the existing container).
- All service-layer logic (health scoring, git parsing, summary generation) gets unit tests with mocked dependencies.
- Test runner: `docker compose exec backend pytest` (or a Makefile/script alias like `make test-backend`).
- Use **pytest-asyncio** for async tests, **httpx** `AsyncClient` for API integration tests against the FastAPI test app.
- Fixtures provide: test database with seeded data, mock git repos (small temp repos created with GitPython in fixtures), mock LLM responses.
- **Coverage target:** Not enforced numerically for v1, but every new endpoint and service method must have corresponding tests *before* implementation.

**Frontend (Vitest + React Testing Library):**
- Component tests for all major UI components (repo card, health badge, contributor list, merge UI).
- Hook tests for data fetching and state logic.
- Test runner: `docker compose exec frontend npx vitest` (or `make test-frontend`).
- Use **MSW (Mock Service Worker)** to mock API responses in component tests.

**Convenience commands (Makefile or scripts):**
```
make test           # Run all tests (backend + frontend)
make test-backend   # Backend tests only
make test-frontend  # Frontend tests only
make test-watch     # Frontend tests in watch mode
```

**TDD workflow for Claude Code:** When implementing a new feature, the build order is always: (1) write failing test(s), (2) implement the minimum code to pass, (3) refactor. This applies to both backend endpoints/services and frontend components. The CLAUDE.md file must reinforce this.

### 8.6 API Design Principles

The API is designed to be consumed by any client, not just the RepoPulse frontend. Decisions that support this:

- **Versioned:** All routes prefixed with `/api/v1/`. Future breaking changes go under `/api/v2/`.
- **Stateless:** No server-side session state. Auth is via JWT in the `Authorization` header. Any client that can send HTTP requests and manage a token can use the API.
- **Documented:** FastAPI auto-generates OpenAPI (Swagger) docs at `/docs` and `/redoc`. All endpoints must have complete Pydantic request/response schemas so the docs are accurate and useful.
- **Consistent error format:** All errors return `{"detail": "...", "error_code": "..."}` with appropriate HTTP status codes.
- **Pagination:** List endpoints support `?limit=` and `?offset=` with a consistent response envelope: `{"items": [...], "total": int, "limit": int, "offset": int}`.
- **CORS:** Configured to allow the frontend origin in dev, with easy extension to other origins for future clients.

### 8.7 Mock Data & Database Seeding

A seed script (`backend/app/db/seed.py`) populates the database with realistic test data for development. Runnable via `docker compose exec backend python -m app.db.seed` or `make seed`.

**Seed data includes:**
- 2–3 mock users (instructor, TA, admin) matching the dev-login cards.
- 2 collections (e.g., "Spring 2026 DB Projects" with CS 3200 tag, "Spring 2026 DS Projects" with DS 4300 tag).
- 5–8 repos per collection with varied health profiles:
  - 2–3 healthy repos (active, well-distributed commits, good messages)
  - 2–3 yellow repos (slowing down, uneven distribution, or stale)
  - 1–2 red repos (inactive, single contributor, poor messages)
- Contributors with realistic alias scenarios (one person with two emails, etc.)
- Sample notes and reminders at repo, contributor, and global levels.
- A few pre-generated AI summaries so the UI is populated without needing an API key on first run.

**Mock git repos:** The seed script also creates small local git repos with synthetic commit histories (varying dates, authors, branch structures, message quality) so the dashboard is fully functional in dev without needing real GitHub repos. These go into a `seed-repos/` directory under the configured repo root.

### 8.8 Key Endpoints

```
Auth:
  POST   /api/auth/login
  POST   /api/auth/dev-login          # Dev mode only

Collections:
  GET    /api/collections
  POST   /api/collections
  GET    /api/collections/{id}
  PUT    /api/collections/{id}
  DELETE /api/collections/{id}
  POST   /api/collections/{id}/sync   # Sync all repos in collection

Repos:
  GET    /api/collections/{id}/repos
  POST   /api/collections/{id}/repos  # Add repo(s) — accepts list of GitHub URLs
  GET    /api/repos/{id}
  DELETE /api/repos/{id}
  POST   /api/repos/{id}/sync         # Sync single repo
  GET    /api/repos/{id}/health       # Health breakdown
  GET    /api/repos/{id}/commits      # Paginated, filterable
  GET    /api/repos/{id}/contributors

Contributors:
  GET    /api/contributors/{id}
  PUT    /api/contributors/{id}       # Edit display name
  POST   /api/contributors/merge      # Merge aliases
  GET    /api/contributors/{id}/aliases

Notes:
  GET    /api/notes                   # Filterable by repo_id, contributor_id, or global
  POST   /api/notes
  PUT    /api/notes/{id}
  DELETE /api/notes/{id}

Summaries:
  POST   /api/summaries/generate      # {type, repo_id?, contributor_id?}
  GET    /api/repos/{id}/summaries
  GET    /api/contributors/{id}/summaries

Settings:
  GET    /api/settings
  PUT    /api/settings
```

---

## 9. Claude Code Build Strategy

### 9.1 Suggested Build Order
1. **Project scaffolding:** Vite + FastAPI project structure, SQLAlchemy models, Alembic init, database setup.
2. **Auth:** User model, dev-login endpoint, mock users seeded on startup, basic JWT middleware.
3. **Collections & Repos CRUD:** API endpoints + frontend pages for creating collections and adding repos.
4. **Git operations:** Clone and fetch via GitPython. Wire to API endpoints.
5. **Commit parsing & contributor discovery:** Parse git log into structured data, auto-create Contributors and Aliases.
6. **Health scoring engine:** Implement all 5 signals, composite scoring, store on Repo model.
7. **Collection dashboard UI:** Repo cards with health badges, sparklines, action buttons.
8. **Repo detail view:** Tabs for overview, contributors, commit history, notes.
9. **Alias merge UI.**
10. **Notes & reminders:** CRUD + display in relevant views.
11. **GenAI integration:** LLM service interface, Anthropic adapter, summary generation and storage.
12. **Settings page.**
13. **Polish:** Loading states, error handling, empty states, responsive layout.

### 9.2 Claude Code Notes
- **CLAUDE.md** should define the project structure, conventions (e.g., Pydantic schemas for all API contracts, async SQLAlchemy throughout, `/api/v1/` prefix), testing expectations (**TDD is mandatory — no feature code without a failing test first**), and seed data requirements.
- **Sub-agents** are a good fit for parallelizable work — e.g., having one agent scaffold the frontend route structure while another builds out the SQLAlchemy models. Also useful for the GenAI integration (prompt engineering as a focused sub-task).
- **Skills/memories:** Capture conventions like "all API responses use Pydantic models," "health scoring runs against local git data only," "SQLAlchemy models use UUID primary keys," "TDD: test first, implement second," "API is versioned under /api/v1/" so they persist across sessions.

---

## 10. Out of Scope for v1 (Future)

- In-app code browsing (v2)
- GitHub API integration beyond clone/fetch (webhooks, PR data, issue tracking)
- Auto-triggered AI summaries (post-sync hooks)
- Configurable health thresholds UI
- Real authentication provider (OAuth, SSO)
- Multi-user collaboration features (shared notes, role-based access)
- Deployment (Docker, cloud hosting)
- GitHub Classroom roster import
- Notifications or alerts (email/Slack when a repo goes red)

---

## 11. Success Criteria

For the end-of-day prototype, "done" means:
1. Can create a collection and add repos by pasting GitHub URLs.
2. App clones repos into the managed directory structure.
3. Can sync repos and see commit data parsed and displayed.
4. Dashboard shows health status badges for each repo.
5. Repo detail view shows contributor stats, commit history, and health breakdown.
6. Can generate at least one type of AI summary.
7. Can add notes to a repo.
8. GitHub and VS Code links work.
9. Mock auth flow works for development.
