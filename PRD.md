# RepoPulse v1.0 — Product Requirements Document

**Author:** Mark (Khoury College, Northeastern University)
**Date:** March 21, 2026
**Target:** Working prototype by end of day

> **Status.** This is the original brief, kept as the record of what was asked
> for. The prototype shipped and then kept going, so the requirements below are
> no longer a description of the running system. Statements of *fact* about the
> architecture have been corrected in place; requirements are left as written,
> with an **As built** note where the delivered behaviour diverges. For the
> current system, read `README.md`; for conventions, `CLAUDE.md`.

---

## 1. Problem Statement

Monitoring student team GitHub repositories across courses is painful. GitHub's UI requires too many clicks when navigating across orgs, GitHub Classroom is slow, and there's no consolidated view that answers the key teaching question: *which teams are progressing, which are struggling, and which students are contributing?*

**RepoPulse** is a local-first web app that gives an instructor a real-time dashboard over a semester's worth of student project repos, with health indicators, contributor analytics, AI-generated summaries, and personal note-taking — all without fighting GitHub's UI.

---

## 2. Users & Auth

- **v1 user:** Single user (the instructor). The app should be architected for multi-user support (TAs, co-instructors) but v1 only needs one real user.
- **Auth model:** Email/password authentication with proper schema and API structure. For development, the login screen presents 2–3 mock user profiles to click into (no password entry needed in dev mode). The mock/real toggle should be controlled via environment variable.
- **User model fields:** `id`, `email`, `password_hash`, `display_name`, `role` (enum: `instructor`, `ta`, `admin`), `created_at`, `updated_at`.

**As built.** Multi-user is real, not just architected for:

- `users` also carries `github_token` (per-user, for private clones) and
  `monthly_token_limit` (per-user LLM allowance; NULL follows the instance
  default, 0 blocks access, admins are never metered).
- A second role system sits beside the instance role: `collection_access` grants
  `co_instructor` or `ta` on a single collection, alongside the collection's
  owner. `app/services/permission_service.py` resolves both.
- The login screen asks for email and password in **both** modes — the mock user
  cards were removed. `AUTH_MODE=dev` still enables `POST /api/v1/auth/dev-login`,
  which issues a token for a user id without a password, as an API affordance.
- Admins never choose anyone's password. Creating a user mints a single-use
  `account_setup_tokens` row and the recipient sets their own at
  `/account-setup`. The same table backs password reset. The first admin is
  bootstrapped with `python -m app.db.seed_admin`.

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
| `local_path` | string | Absolute path to local clone, as seen *inside the backend container* (server-side only) |
| `health_status` | enum | `green`, `yellow`, `red`, `unknown` |
| `health_score` | JSON | Breakdown of individual signal scores |
| `last_synced_at` | datetime (nullable) | Last successful git fetch |
| `created_at` | datetime | |
| `updated_at` | datetime | |

**As built,** `repos` also carries: `last_commit_at`,
`expected_contributor_count` (drives the participation signal, §5),
`size_bytes` / `git_size_bytes` / `size_computed_at` (measured at sync, never
per request — walking full clones on a dashboard load is unbounded work), and
the shared sync state `sync_status` / `sync_started_at` / `sync_started_by_id` /
`sync_error`, so a sync one user starts is visible to everyone on the
collection.

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

**As built,** notes also carry `commit_hash` (a fourth scope: a note pinned to
one commit), `remind_at` (when a reminder fires — NULL never notifies),
`is_checked`, and `deleted_at`. Deletion is soft: the row stays and appears in
a Recently deleted list, so every listing must filter `deleted_at IS NULL`.
Notes additionally have comments (`note_comments`, with `@`-mentions) and can
be shared with other users (`reminder_shares`), so one reminder fires for
several people.

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

### 3.7 AppSettings (keyed per-user)

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `user_id` | FK → User | |
| `repo_root_directory` | string | Default `/repos` |
| `health_thresholds` | JSON (nullable) | Per-signal cutoffs (see §5) |
| `commit_evaluation_criteria` | text | Instructor's optional grading rubric, an addendum to the built-in commit-classifier criteria |

**As built,** `llm_provider`, `llm_model` and the API key are **not** here. They
were moved to a single instance-wide `llm_config` row (§7.1): every user talks
to the same model through the same key, and only an administrator can change
which. The grading rubric stays per-user, being editorial judgement rather than
a billing or provider concern.

### 3.8 Entities added after v1

Summarised here so the data model is complete; each is documented in its model
file.

| Table | Purpose |
|---|---|
| `collection_access` | Grants `co_instructor` / `ta` on one collection |
| `account_setup_tokens` | Single-use links for setting a password |
| `commits` | Snapshot of the last successful parse, so the UI degrades to "what we last saw" when a clone is unreadable. Not the source of truth — commits are re-read from the clone |
| `commit_classifications` | LLM-derived commit type (substantive / logistical) and quality score, cached by `(repo_id, commit_hash)` |
| `pull_requests` | PRs fetched from the GitHub API, with review and merge state |
| `note_comments`, `reminder_shares` | Threaded comments, and reminders shared with other users |
| `notifications`, `notification_preferences` | In-app notifications and per-user subscriptions |
| `llm_config` | The instance's single LLM configuration, provider, model, key, limits and prices |
| `llm_token_usage` | Per-call token counts as reported by the provider |

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

**As built,** this still holds for everything derived from history. The one
addition is **pull-request sync**, which has no git equivalent and does call
the GitHub REST API, per repo and on demand. Authentication throughout — clone,
fetch and PR sync — is the **signed-in user's** `github_token`, set on their
Settings page; without one, adding a repo returns 403. The `GITHUB_TOKEN` env
var is not a fallback, and is only read to report "configured" on the admin
System card. `git_service._inject_token` embeds the token in the remote URL,
which means it is
written into the clone's `.git/config` — each clone and fetch strips any
previously embedded credential first, so a rotated token does not leave a
stale one blocking authentication.

---

## 5. Health Signals & Scoring

Each repo gets a composite health status (`green`, `yellow`, `red`) derived from five weighted signals. All analysis runs against the local git data.

**As built,** there are six: a *participation* signal was added, scoring actual
contributors against the repo's `expected_contributor_count`. It is only
measurable when that count is set, so without one it is omitted rather than
defaulted, and the composite divides by five signals instead of six.

### 5.1 Signals

| Signal | What it measures | Green | Yellow | Red |
|---|---|---|---|---|
| **Commit frequency** | Commits per week (team-wide) | ≥10/week | 4–9/week | ≤3/week |
| **Recency** | Time since last commit | <3 days | 3–7 days | >7 days |
| **Distribution** | Gini coefficient of commits across contributors | Gini <0.35 | 0.35–0.60 | >0.60 |
| **Branch activity** | Number of active branches; evidence of feature-branch workflow | ≥2 active branches | 1 branch with recent activity | All commits on main/single branch, no branching |
| **Commit message quality** | Average message length; flags single-word or empty messages | <10% low-quality | 10–30% low-quality | >30% low-quality |
| **Participation** *(added)* | Actual contributors ÷ `expected_contributor_count` | ≥1.0 | 0.6–0.99 | <0.6 |

### 5.2 Composite Score
- Each signal scores 0 (red), 1 (yellow), or 2 (green).
- Composite = score sum ÷ maximum possible, so it ranges **0.0–1.0** (not 0–2):
  ten points across five signals, twelve when participation is scored.
- Composite ≥ 0.75 → **Green**, ≥ 0.375 → **Yellow**, below → **Red**.
- Cutoffs live in `app/services/health_thresholds.py` rather than as literals
  in `HealthService`, because "healthy" is a judgement about how a course
  should work. `resolve_thresholds` merges a stored override over the defaults,
  so a partial or malformed override costs only the cutoffs it got wrong.
  `AppSettings.health_thresholds` is the column that holds an override; the
  sync path does not yet pass one, so scoring currently runs against the
  shipped defaults.

### 5.3 Staleness
Health status shows as `unknown` if the repo has never been synced or if the last sync was more than 7 days ago (visual indicator that data may be stale).

**As built,** `unknown` means "never synced" only — a repo keeps its last
computed badge however old the sync is. Staleness is surfaced separately, by
`last_synced_at` in the UI and by the admin Overview tab's sync-health card.

---

## 6. Screens & UI

### 6.1 Login Screen
- Dev mode: Displays 2–3 mock user cards to click into.
- Prod mode: Standard email/password form.
- Controlled by `AUTH_MODE=dev|prod` env var.

**As built,** the screen is the email/password form in both modes; the mock
cards were removed along with the mock data. `AUTH_MODE` now only decides
whether the `dev-login` *endpoint* answers. Two further routes joined it:
`/account-setup`, where an invited user sets their own password, and `/` when
signed out, which serves the static landing page in `frontend/public/`.

### 6.2 Home / Collections List
- List of all collections with name, course/semester tags, repo count, and a mini health summary (e.g., "8 green, 2 yellow, 1 red").
- "New Collection" button → name, folder name, optional course/semester tags.
- Access to global scratchpad.
- App settings link.

**As built,** these split in two. `/collections` is the list described here;
`/` (signed in) is a cross-collection **dashboard** — search, health mix,
staleness, workspace pulse and insight tiles over every repo the user can see.
A persistent collapsible sidebar carries navigation, the notification bell and
active reminders, replacing the per-page settings link.

### 6.3 Collection Dashboard
The primary working screen.

- **Header:** Collection name, tags, sync all button, "Add Repo(s)" button.
- **Repo cards** in a grid or list layout, each showing:
  - Repo name
  - Health status badge (colored dot or pill: green/yellow/red/grey)
  - Contributor count (prominent)
  - Last commit date
  - Quick-stat sparkline or mini bar chart (commits over last 4 weeks)
  - Buttons: "GitHub" (opens repo on github.com), "VS Code" (opens the repo in VS Code for the Web at `https://vscode.dev/github/{owner}/{repo}`), "Details"
  - Any active reminders for this repo shown as a small indicator/badge
- **Sorting/filtering:** By health status, last activity, name.
- **Bulk actions:** Sync all, generate all summaries.

### 6.4 Repo Detail View
Deep dive into a single repo.

- **Header:** Repo name, health status (with breakdown of all 5 signals), GitHub link, VS Code for the Web link, sync button.
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

**As built,** LLM configuration is not here — it is instance-wide and
administrator-only (§7.1). The user-facing Settings page carries display name,
the user's own GitHub token, their commit-evaluation rubric, the model in use
(read-only), and their token usage for the month. Provider, model, key, limits
and prices live in the admin panel's AI Settings tab.

### 6.7 Admin Panel *(added)*
At `/admin`, gated on the `admin` instance role. Three tabs:

1. **Overview:** coverage, storage by collection and repo, sync health, LLM
   call volume over time, and an attention panel of faults worth acting on.
2. **Users:** create, edit, promote and remove users; mint setup links; set
   per-user monthly token limits.
3. **AI Settings:** provider, model, API key, default and per-user token
   limits, per-million-token prices, and the token-and-cost report priced from
   those rates.

The panel reports on the health of the *instance*. Student and repo
performance belongs in the instructor-facing views.

### 6.8 Notifications *(added)*
A bell in the sidebar and a `/notifications` page. Events: mentions, note
comments, due reminders, repos added or removed, health declines, and pull
requests opened or merged. Each is mutable per user, and muting suppresses
creation rather than hiding a row. Dismissals soft-delete into a Recently
deleted list.

---

## 7. GenAI Integration

### 7.1 Architecture
- **LLM Service Interface:** An abstract `LLMService` class with a `generate(prompt, context) → str` method.
- **Anthropic Adapter:** Implements `LLMService` using the Anthropic SDK. Reads API key from `ANTHROPIC_API_KEY` env var. Model selected from `AppSettings.llm_model`.
- Future adapters (OpenAI, local models) implement the same interface.

**As built:**

- The second adapter is **Ollama**, for a locally-running model.
  `get_llm_service(provider, model, ...)` picks between them.
- Provider, model and key come from the single instance-wide `llm_config` row,
  set by an administrator, not from per-user settings. `resolve_llm_settings`
  is the one resolver. The Anthropic adapter still falls back to the
  `ANTHROPIC_API_KEY` env var when no key is stored, so a Compose install works
  without anyone opening the admin panel.
- **Calls are metered.** Every LLM entry point calls `require_quota` before
  building an adapter and `record_usage` after; exceeding a monthly (calendar,
  UTC) allowance returns 429. Token counts are what the provider reported —
  never estimated — and cost is priced only from administrator-entered rates,
  reported as *unavailable* rather than `$0.00` when no rates are set.
- A fourth consumer joined the three summary types: the **commit classifier**,
  which labels each commit substantive or logistical and scores its quality,
  cached per commit hash so a commit costs one call ever.
- Anthropic calls are traced through OpenTelemetry to Arize Phoenix when
  `OTEL_EXPORTER_OTLP_ENDPOINT` is set.

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
- **OpenTelemetry** (+ `openinference` Anthropic instrumentation) exporting to Arize Phoenix, initialized only when `OTEL_EXPORTER_OTLP_ENDPOINT` is set

### 8.3 Local Development (Docker Compose)
Four-service architecture:
```yaml
services:
  frontend:    # Node/Vite dev server, hot reload, port 5173
  backend:     # FastAPI with uvicorn, hot reload, port 8000
  db:          # postgres:16-alpine, persistent volume, port 5432
  phoenix:     # arizephoenix/phoenix, LLM trace viewer, port 6006
```
- **Volumes:** Backend mounts the repo root directory from the host so GitPython can operate on local clones. Postgres data persists via a named volume, as does Phoenix's trace store. `db/init/` seeds the test database, and runs only when that volume is fresh.
- **Environment:** `.env` file at project root with `DATABASE_URL`, `TEST_DATABASE_URL`, `SECRET_KEY`, `AUTH_MODE`, `REPO_ROOT_DIR`, `ANTHROPIC_API_KEY`, `GITHUB_TOKEN`. `REPO_ROOT_DIR` is the **container** path (`/repos`) and must be absolute — the backend refuses to start otherwise, because a relative path resolves outside the mount and clones are lost on rebuild.
- **Schema:** `backend/entrypoint.sh` runs `alembic upgrade head` before uvicorn, and only when the container is starting the API server. Nothing calls `Base.metadata.create_all` outside the test fixtures. `/healthz` probes the database and reports the schema revision, answering 503 when unreachable or unmigrated.
- **Note on git clones:** The repos are cloned into `REPO_ROOT_DIR` and bind-mounted into the backend container so GitPython can read git data. `local_path` is the path *inside the container*, so it is a server-side detail only — nothing user-facing may treat it as a path on the viewer's machine. The "Open in VS Code" button therefore does not use it: it opens VS Code for the Web against GitHub (`https://vscode.dev/github/{owner}/{repo}`), which needs no local clone and so works identically in local dev and on a public deployment, where clones live in a Docker volume no browser can reach.

### 8.4 Project Structure

The shipped layout follows this shape but has grown well past it — the LLM
adapters became a package, and `scripts/`, `docs/`, `db/init/` and a
root-level `tests/` were added. **`CLAUDE.md` holds the current tree**, and is
the file to update when the structure changes. In outline:

```
repo-pulse/
├── docker-compose.yml      # frontend, backend, db, phoenix
├── Makefile
├── db/init/                # runs once, on a fresh postgres volume
├── seed-repos/             # clone root, mounted into the backend as /repos
├── tests/                  # landing page + product tour (node --test)
├── docs/plans/             # design notes for larger changes
├── frontend/               # public/ (landing.html, tour.html), src/{components,pages,hooks,services,lib,types,mocks,__tests__}
├── backend/                # entrypoint.sh, app/{api,models,schemas,services,db,core}, scripts/, tests/
├── CLAUDE.md               # conventions — the single source of truth
├── AGENTS.md               # pointer to CLAUDE.md
├── PRD.md
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
make test           # Run all tests (backend + frontend + landing)
make test-backend   # Backend tests only
make test-db        # Create the test database (pre-existing volumes only)
make test-smoke     # Import/startup smoke tests, no database
make test-migrations # The migration checks CI gates a merge on
make test-frontend  # Frontend tests only
make test-landing   # Landing page + product tour, no stack, no browser
make test-watch     # Frontend tests in watch mode
```

**As built,** two things were added to this strategy:

- A **third suite** covers the landing page and the product tour. They are
  static documents in `frontend/public/`, so their tests parse each file, run
  its script in jsdom, and check structure, cascade and contrast without a
  stack or a browser. Everything layout-dependent is arithmetic, never a
  measurement.
- Tests that hit a real LLM API are marked `llm` and **deselected by default**
  (`pytest.ini`), because they cost money and need a key. The commit-classifier
  accuracy gate is the one such suite; run it with `pytest -m llm`.
- CI (`.github/workflows/migrations.yml`) gates a merge on migrations only: the
  chain applies to an empty database, the result matches the models, there is
  one head, and upgrade→downgrade→upgrade round-trips.

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

**As built, this has been retired.** `backend/app/db/seed.py` is commented out
in full and `make seed` does nothing: the mock users, collections and synthetic
histories were removed in favour of working against real repositories. Nothing
should be written that depends on seeded demo data.

Bootstrapping now means creating the first administrator, since
`POST /api/v1/users` is admin-gated and a fresh database has nobody to
authorize it:

```bash
ADMIN_EMAIL=you@example.com make seed-admin
```

`app/db/seed_admin.py` writes exactly one user row — and, when no
`ADMIN_PASSWORD` is given, one setup token — rather than truncating tables the
way `seed.py` did, so it is safe against a real deployment. Re-running it
promotes an existing account, which is the recovery path for a locked-out
admin. `seed-repos/` survives as the clone root bind-mounted at `/repos`.

### 8.8 Key Endpoints

Every route is under `/api/v1` — the brief's `/api/...` sketch predates the
versioning rule in §8.6. The authoritative list is the OpenAPI document at
`/docs`; this is the shipped surface in outline.

```
Meta (no auth, unversioned):
  GET    /healthz                     # DB reachable + schema revision; 503 otherwise

Auth:
  POST   /api/v1/auth/login
  POST   /api/v1/auth/dev-login          # AUTH_MODE=dev only
  POST   /api/v1/auth/account-setup/verify
  POST   /api/v1/auth/account-setup/complete

Users:
  GET    /api/v1/users                   # admin
  POST   /api/v1/users                   # admin — mints a setup link
  GET    /api/v1/users/me
  PATCH  /api/v1/users/me
  POST   /api/v1/users/me/change-password
  GET    /api/v1/users/{id}
  PATCH  /api/v1/users/{id}              # admin
  DELETE /api/v1/users/{id}              # admin
  POST   /api/v1/users/{id}/setup-link   # admin — re-issue

Collections:
  GET    /api/v1/collections
  POST   /api/v1/collections
  GET    /api/v1/collections/{id}
  PATCH  /api/v1/collections/{id}
  DELETE /api/v1/collections/{id}
  POST   /api/v1/collections/{id}/sync              # Sync all repos in collection
  GET    /api/v1/collections/{id}/commit-activity
  GET    /api/v1/collections/{id}/contextual-activity
  GET    /api/v1/collections/{id}/commit-quality
  GET    /api/v1/collections/{id}/access            # Sharing
  POST   /api/v1/collections/{id}/access
  DELETE /api/v1/collections/{id}/access/{user_id}

Repos:
  GET    /api/v1/collections/{id}/repos
  POST   /api/v1/collections/{id}/repos  # Add repo(s) — accepts list of GitHub URLs
  GET    /api/v1/repos/{id}
  PATCH  /api/v1/repos/{id}
  DELETE /api/v1/repos/{id}
  POST   /api/v1/repos/{id}/sync         # Sync single repo
  GET    /api/v1/repos/{id}/health       # Health breakdown
  GET    /api/v1/repos/{id}/commits      # Paginated, filterable
  GET    /api/v1/repos/{id}/contributors
  POST   /api/v1/repos/{id}/commits/classify        # LLM — quota enforced
  POST   /api/v1/repos/{id}/pull-requests/sync      # GitHub API
  GET    /api/v1/repos/{id}/pull-requests
  GET    /api/v1/repos/{id}/pull-requests/stats

Contributors:
  GET    /api/v1/contributors/{id}
  PUT    /api/v1/contributors/{id}       # Edit display name
  POST   /api/v1/contributors/merge      # Merge aliases
  POST   /api/v1/contributors/{id}/unmerge
  GET    /api/v1/contributors/{id}/aliases

Notes:
  GET    /api/v1/notes                   # Filterable by repo_id, contributor_id, or global
  POST   /api/v1/notes
  PATCH  /api/v1/notes/{id}
  DELETE /api/v1/notes/{id}              # Soft delete
  POST   /api/v1/notes/{id}/restore
  DELETE /api/v1/notes/{id}/permanent
  GET    /api/v1/notes/{id}/comments
  POST   /api/v1/notes/{id}/comments
  DELETE /api/v1/notes/{id}/comments/{comment_id}

Notifications:
  GET    /api/v1/notifications
  GET    /api/v1/notifications/unread-count
  GET    /api/v1/notifications/reminders
  GET    /api/v1/notifications/preferences
  PUT    /api/v1/notifications/preferences
  PATCH  /api/v1/notifications/{id}/read
  PATCH  /api/v1/notifications/{id}/unread
  POST   /api/v1/notifications/mark-all-read
  POST   /api/v1/notifications/mark-all-unread
  GET    /api/v1/notifications/recently-deleted
  DELETE /api/v1/notifications/{id}
  POST   /api/v1/notifications/{id}/restore
  DELETE /api/v1/notifications/{id}/permanent

Summaries:
  POST   /api/v1/summaries/generate      # {type, repo_id?, contributor_id?} — LLM, quota enforced
  GET    /api/v1/repos/{id}/summaries
  GET    /api/v1/contributors/{id}/summaries

Settings (per-user):
  GET    /api/v1/settings
  PATCH  /api/v1/settings
  GET    /api/v1/settings/token-usage
  GET    /api/v1/settings/ollama-models

Admin (admin role only):
  GET    /api/v1/admin/overview
  GET    /api/v1/admin/storage
  GET    /api/v1/admin/storage/repos
  POST   /api/v1/admin/storage/recalculate
  GET    /api/v1/admin/system            # Shares its schema probe with /healthz
  GET    /api/v1/admin/pipeline
  GET    /api/v1/admin/attention
  GET    /api/v1/admin/llm-usage         # Call volume for the Overview card
  GET    /api/v1/admin/llm-config
  PATCH  /api/v1/admin/llm-config
  GET    /api/v1/admin/token-usage
  GET    /api/v1/admin/token-usage/summary
  PATCH  /api/v1/admin/users/{id}/token-limit
```

One error envelope beyond the one in §8.6: an exhausted LLM quota answers 429
with `{detail, period, used, limit}`, since the numbers are the actionable part.

---

## 9. Claude Code Build Strategy

### 9.1 Suggested Build Order

**All thirteen steps are complete.** For where current work lives, see the
"Where Things Live" table in `CLAUDE.md`.

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

Several of these have since shipped. Marked accordingly.

| Item | Status |
|---|---|
| In-app code browsing (v2) | Still out of scope. "Open in VS Code" opens VS Code for the Web against GitHub instead |
| GitHub API integration beyond clone/fetch (webhooks, PR data, issue tracking) | **Partly shipped** — pull requests are fetched and tracked (`github_service.py`). Webhooks and issues remain out |
| Auto-triggered AI summaries (post-sync hooks) | Still out of scope. Generation stays on-demand |
| Configurable health thresholds UI | **Partly shipped** — thresholds are data, not literals (`health_thresholds.py`), and `AppSettings.health_thresholds` can hold an override. No UI, and the sync path does not yet pass one |
| Real authentication provider (OAuth, SSO) | Still out of scope. Auth is email/password plus single-use setup links |
| Multi-user collaboration features (shared notes, role-based access) | **Shipped** — collection sharing with co-instructor/TA roles, shared reminders, note comments and `@`-mentions |
| Deployment (Docker, cloud hosting) | **Partly shipped** — the stack runs under Compose with migrations applied at startup, an admin bootstrap script, and a healthcheck. No managed hosting |
| GitHub Classroom roster import | Still out of scope. `expected_contributor_count` is set by hand |
| Notifications or alerts (email/Slack when a repo goes red) | **Shipped in-app** — including a health-decline notification, with per-user subscriptions. Email and Slack relay remain out; an email-relay experiment was added in migration 0004 and dropped again in 0007 |

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
8. GitHub and VS Code for the Web links work.
9. Mock auth flow works for development.

All nine were met. Criterion 9 has since been narrowed: the dev-login endpoint
remains behind `AUTH_MODE=dev`, but the mock user cards and the mock data
behind them were removed in favour of real accounts (§8.7).
