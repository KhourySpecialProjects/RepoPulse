/**
 * The admin Overview dashboard.
 *
 * Two things these tests defend, beyond the numbers.
 *
 * The admin/instructor boundary. This page is about running the application,
 * so the per-signal health breakdown, commits-per-day and days-since-last-
 * commit are deliberately absent — they answer "how are the students doing".
 * The negative assertions below are there so that adding one is a conscious
 * decision rather than a quiet drift.
 *
 * The range-scoping contract. The filter scopes the "Over time" section and
 * not the "Right now" one. If that ever silently changes, two cards will be
 * describing different weeks with nothing on screen saying so.
 *
 * Numbers are asserted through each card's table view rather than its SVG.
 * The table has to exist anyway for accessibility, and Recharts renders to
 * paths that assert badly in jsdom — so this is the honest read of the same
 * data, not a workaround.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { HttpResponse, http } from 'msw'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AdminPage } from '@/pages/AdminPage'
import { server } from '@/mocks/server'

const mockUser = { role: 'admin' as string | undefined }

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: mockUser.role
      ? { id: 'u1', display_name: 'Admin', role: mockUser.role }
      : null,
    isAuthenticated: true,
    isLoading: false,
  }),
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

function renderAdmin() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/admin']}>
        <AdminPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

/** Flip a card into its table view, where the values are text. */
async function openTable(user: ReturnType<typeof userEvent.setup>, testId: string) {
  const card = await screen.findByTestId(testId)
  // findByRole, not getByRole: the card's testId is on the container and so
  // resolves while it is still loading, but the toggle only appears once the
  // data has landed.
  await user.click(await within(card).findByRole('button', { name: 'Table' }))
  return card
}

beforeEach(() => {
  localStorage.clear()
  mockUser.role = 'admin'
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// Section A — service status and attention
// ---------------------------------------------------------------------------

describe('Service status', () => {
  it('reports configuration faults rather than a wall of green ticks', async () => {
    renderAdmin()

    const status = await screen.findByTestId('service-status')
    // The shared fixture runs with dev-login off but a retired model still in
    // use — migration 0002 exists because a retired model id started 404ing,
    // so this is the chip that would have caught it.
    expect(status).toHaveTextContent(/running with warnings|needs attention/i)
    expect(await screen.findByTestId('fault-retired-models')).toHaveTextContent(
      /retired model/i,
    )
  })

  it('says so plainly when nothing is wrong', async () => {
    server.use(
      http.get('/api/v1/admin/system', () =>
        HttpResponse.json({
          status: 'ok',
          server_time: '2026-09-14T10:00:00Z',
          database: 'ok',
          schema_revision: '0006',
          schema_head: '0006',
          schema_up_to_date: true,
          auth_mode: 'production',
          dev_login_enabled: false,
          admin_count: 2,
          repo_root_dir: '/repos',
          repo_root_exists: true,
          repo_root_writable: true,
          anthropic_api_key_configured: true,
          github_token_configured: true,
          default_llm_provider: 'anthropic',
          default_llm_model: 'claude-sonnet-5',
          git_version: 'git version 2.43.0',
        }),
      ),
      http.get('/api/v1/admin/llm-usage', () =>
        HttpResponse.json({
          window_days: 30,
          total_calls: 0,
          by_model: [],
          daily: [],
          by_collection_owner: [],
          unattributed_summaries: 0,
          models_in_use: [],
          retired_models_in_use: [],
          current_default_model: 'claude-sonnet-5',
          generated_at: '2026-09-14T10:00:00Z',
        }),
      ),
    )

    renderAdmin()

    expect(await screen.findByText(/all systems normal/i)).toBeInTheDocument()
  })

  it('escalates an unreachable database to an assertive alert', async () => {
    server.use(
      http.get('/api/v1/admin/system', () =>
        HttpResponse.json({
          status: 'degraded',
          server_time: '2026-09-14T10:00:00Z',
          database: 'unreachable',
          schema_revision: null,
          schema_head: '0006',
          schema_up_to_date: null,
          auth_mode: 'production',
          dev_login_enabled: false,
          admin_count: 2,
          repo_root_dir: '/repos',
          repo_root_exists: true,
          repo_root_writable: true,
          anthropic_api_key_configured: true,
          github_token_configured: true,
          default_llm_provider: 'anthropic',
          default_llm_model: 'claude-sonnet-5',
          git_version: null,
        }),
      ),
    )

    renderAdmin()

    expect(await screen.findByTestId('fault-database')).toBeInTheDocument()
    expect(await screen.findByTestId('service-status')).toHaveAttribute(
      'role',
      'alert',
    )
  })

  it('flags dev login, which mints a token from a bare user id', async () => {
    server.use(
      http.get('/api/v1/admin/system', () =>
        HttpResponse.json({
          status: 'ok',
          server_time: '2026-09-14T10:00:00Z',
          database: 'ok',
          schema_revision: '0006',
          schema_head: '0006',
          schema_up_to_date: true,
          auth_mode: 'dev',
          dev_login_enabled: true,
          admin_count: 2,
          repo_root_dir: '/repos',
          repo_root_exists: true,
          repo_root_writable: true,
          anthropic_api_key_configured: true,
          github_token_configured: true,
          default_llm_provider: 'anthropic',
          default_llm_model: 'claude-sonnet-5',
          git_version: null,
        }),
      ),
    )

    renderAdmin()

    const chip = await screen.findByTestId('fault-dev-login')
    expect(chip).toHaveTextContent(/dev login enabled/i)
    // The chip is one line now; the explanation rides its title attribute.
    expect(chip).toHaveAttribute('title', expect.stringMatching(/no password/i))
  })

  it('warns when a single administrator is a lockout risk', async () => {
    server.use(
      http.get('/api/v1/admin/overview', () =>
        HttpResponse.json({
          counts: {
            users: 3,
            admins: 1,
            instructors: 2,
            tas: 0,
            collections: 2,
            archived_collections: 1,
            repos: 4,
            contributors: 7,
            notes: 9,
            note_comments: 2,
            summaries: 6,
            commit_classifications: 12,
            pull_requests: 3,
            notifications: 11,
            collection_access: 1,
          },
          health: { green: 2, yellow: 1, red: 1, unknown: 0 },
          sync: {
            total: 4,
            never_synced: 1,
            stale: 1,
            fresh: 2,
            stale_after_days: 7,
            most_recent_sync: '2026-09-14T09:00:00Z',
            oldest_sync: '2026-08-20T09:00:00Z',
          },
          generated_at: '2026-09-14T10:00:00Z',
        }),
      ),
    )

    renderAdmin()

    const warning = await screen.findByTestId('admin-count-warning')
    expect(warning).toHaveTextContent(/only one administrator/i)
    // Advisory, not assertive: it is a risk worth knowing, not a failure.
    expect(warning).toHaveAttribute('role', 'status')
  })

  it('flags a repo root that is not mounted, which otherwise fails silently', async () => {
    server.use(
      http.get('/api/v1/admin/system', () =>
        HttpResponse.json({
          status: 'degraded',
          server_time: '2026-09-14T10:00:00Z',
          database: 'ok',
          schema_revision: '0006',
          schema_head: '0006',
          schema_up_to_date: true,
          auth_mode: 'production',
          dev_login_enabled: false,
          admin_count: 2,
          repo_root_dir: '/repos',
          repo_root_exists: false,
          repo_root_writable: false,
          anthropic_api_key_configured: true,
          github_token_configured: true,
          default_llm_provider: 'anthropic',
          default_llm_model: 'claude-sonnet-5',
          git_version: null,
        }),
      ),
    )

    renderAdmin()

    expect(
      await screen.findByTestId('fault-repo-root-missing'),
    ).toBeInTheDocument()
  })
})

describe('Repos needing attention', () => {
  it('names the repos and why each one is listed', async () => {
    renderAdmin()

    const list = await screen.findByTestId('attention-list')
    expect(within(list).getByText('team-alpha')).toBeInTheDocument()
    expect(within(list).getByText('Last sync failed')).toBeInTheDocument()
    expect(within(list).getByText('Never synced')).toBeInTheDocument()
  })

  it('reports an all-clear instead of an empty list', async () => {
    server.use(
      http.get('/api/v1/admin/attention', () =>
        HttpResponse.json({
          items: [],
          total: 0,
          limit: 10,
          offset: 0,
          generated_at: '2026-09-14T10:00:00Z',
        }),
      ),
    )

    renderAdmin()

    expect(await screen.findByTestId('attention-clear')).toHaveTextContent(
      /synced, measured and scored/i,
    )
  })

  it('never lists a repo for being unhealthy', async () => {
    /**
     * The boundary this page exists to hold. A struggling project is an
     * instructor's problem; if a `health_red`-style reason ever appears in
     * this feed it will push the faults only an admin can fix down the list.
     */
    renderAdmin()

    const list = await screen.findByTestId('attention-list')
    expect(within(list).queryByText(/failing/i)).not.toBeInTheDocument()
    expect(within(list).queryByText(/unhealthy/i)).not.toBeInTheDocument()
    expect(within(list).queryByText(/at risk/i)).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Section B — ingestion and integrations
// ---------------------------------------------------------------------------

describe('Sync health', () => {
  it('splits live sync state three ways including zero states', async () => {
    renderAdmin()

    expect(await screen.findByTestId('sync-state-idle')).toHaveTextContent('2')
    // Zero must still render: otherwise a healthy instance and a broken query
    // look identical.
    expect(screen.getByTestId('sync-state-syncing')).toHaveTextContent('0')
    expect(screen.getByTestId('sync-state-failed')).toHaveTextContent('2')
  })

  it('collapses repos sharing one error into a single diagnosable row', async () => {
    renderAdmin()

    const groups = await screen.findByTestId('sync-error-groups')
    expect(within(groups).getByText('Authentication failed')).toBeInTheDocument()
    expect(groups).toHaveTextContent('2 repos')
  })

  it('shows the age histogram with never as its own bucket', async () => {
    const user = userEvent.setup()
    renderAdmin()

    const card = await openTable(user, 'sync-health')
    // Never-synced is not "synced a very long time ago".
    expect(card).toHaveTextContent('Never synced')
    expect(card).toHaveTextContent('Over 30 days')
  })

  it('measures time since last sync, not time since last commit', async () => {
    /**
     * A one-word difference with a big consequence: last_synced_at is an
     * operations metric, last_commit_at is a statement about students.
     */
    renderAdmin()

    const card = await screen.findByTestId('sync-health')
    expect(card).toHaveTextContent(/since.*sync/i)
    expect(card).not.toHaveTextContent(/since last commit/i)
  })
})

describe('Data coverage', () => {
  it('reports each gap against its own denominator', async () => {
    renderAdmin()

    const unmeasured = await screen.findByTestId('coverage-unmeasured_clone')
    expect(unmeasured).toHaveTextContent('2')
    expect(unmeasured).toHaveTextContent('/ 4')
  })

  it('carries the pipeline reading of health data, not the student one', async () => {
    renderAdmin()

    const card = await screen.findByTestId('coverage-card')
    expect(
      await screen.findByTestId('coverage-no_health_score'),
    ).toBeInTheDocument()
    expect(screen.getByTestId('coverage-unknown_health')).toBeInTheDocument()
    // No per-signal breakdown: commit frequency, distribution and message
    // quality are an instructor's view of the same underlying JSON.
    expect(card).not.toHaveTextContent(/commit frequency/i)
    expect(card).not.toHaveTextContent(/message quality/i)
    expect(card).not.toHaveTextContent(/gini/i)
  })

  it('surfaces drift in both directions', async () => {
    renderAdmin()

    expect(await screen.findByTestId('coverage-missing_clone')).toHaveTextContent(
      '1',
    )
    expect(screen.getByTestId('coverage-orphan_directory')).toHaveTextContent('1')
  })
})

describe('LLM call volume', () => {
  it('renders the daily series the API has always returned', async () => {
    const user = userEvent.setup()
    renderAdmin()

    const card = await openTable(user, 'llm-volume')
    expect(card).toHaveTextContent('2026-09-14')
    expect(card).toHaveTextContent('Commit classifications')
  })

  it('shows no cost figure, and points at where the real one lives', async () => {
    /**
     * Token counts are persisted now, so a cost figure is computable — but
     * only against rates an admin enters, and only this card's call counts
     * are in scope here. A chart is exactly where a plausible-looking cost
     * line gets added, so the negative assertion stays; what changed is that
     * the card now names the screen that has the real number instead of
     * saying it does not exist.
     */
    renderAdmin()

    const card = await screen.findByTestId('llm-volume')
    expect(card).not.toHaveTextContent('$')
    expect(card).not.toHaveTextContent(/\busd\b/i)
    expect(card).toHaveTextContent(/tokens and cost are on the AI Settings tab/i)
  })

  it('flags retired models still in use', async () => {
    renderAdmin()

    expect(await screen.findByTestId('llm-volume-retired')).toHaveTextContent(
      'claude-sonnet-4-20250514',
    )
  })

  it('counts commit-quality scoring as call volume', async () => {
    /**
     * Three features spend tokens. While volume came from a union over
     * `summaries` and `commit_classifications`, commit-quality scoring was
     * invisible — the stacked areas summed to less than the card's own total.
     */
    const user = userEvent.setup()
    renderAdmin()

    const card = await openTable(user, 'llm-volume')
    expect(card).toHaveTextContent('Commit quality')
  })

  it('opens the AI Settings tab, where per-user usage and limits live', async () => {
    /**
     * This card answers "how much load"; the question it provokes is "from
     * whom, and against what limit". That is one tab away and the footer used
     * to only name it in prose.
     */
    const user = userEvent.setup()
    renderAdmin()

    const card = await screen.findByTestId('llm-volume')
    await user.click(
      await within(card).findByRole('button', { name: /per-user usage and limits/i }),
    )

    expect(
      await screen.findByRole('heading', { name: /per-user usage and limits/i }),
    ).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Section C — capacity and database
// ---------------------------------------------------------------------------

describe('Storage capacity', () => {
  it('renders a meter with the accessible value', async () => {
    renderAdmin()

    const meter = await screen.findByRole('meter', { name: /disk used/i })
    expect(meter).toHaveAttribute('aria-valuenow', '40')
  })

  it('reads as not mounted rather than as an empty disk', async () => {
    /**
     * Zero bytes used looks like a healthy empty volume, which is the exact
     * opposite of an unmounted root.
     */
    server.use(
      http.get('/api/v1/admin/storage', () =>
        HttpResponse.json({
          disk: {
            root: '/repos',
            exists: false,
            total_bytes: 0,
            used_bytes: 0,
            free_bytes: 0,
            percent_used: 0,
          },
          clones: {
            measured_repos: 0,
            unmeasured_repos: 0,
            total_bytes: 0,
            git_bytes: 0,
            oldest_measurement: null,
            newest_measurement: null,
          },
          database_bytes: 1024,
          tables: [],
          drift: {
            orphan_directories: [],
            missing_clones: [],
            orphan_bytes: null,
          },
          repo_root_dir: '/repos',
          generated_at: '2026-09-14T10:00:00Z',
        }),
      ),
    )

    renderAdmin()

    expect(await screen.findByTestId('capacity-missing')).toHaveTextContent(
      /not mounted/i,
    )
    expect(screen.queryByRole('meter')).not.toBeInTheDocument()
  })
})

describe('Storage', () => {
  it('puts capacity and the largest clones in one card', async () => {
    // They answer halves of one question — how much room is left, and what
    // is using it — so they are grouped rather than split across the layout.
    renderAdmin()

    const card = await screen.findByTestId('storage-card')
    expect(within(card).getByTestId('capacity-meter')).toBeInTheDocument()
    // Awaited separately: the per-repo sizes are a second request and land
    // after the storage summary the meter is drawn from.
    expect(await within(card).findByTestId('largest-clones-chart')).toBeInTheDocument()
  })

  it('lists measured clones with their sizes', async () => {
    const user = userEvent.setup()
    renderAdmin()

    const card = await openTable(user, 'storage-card')
    expect(within(card).getByRole('table')).toBeInTheDocument()
  })

  it('excludes never-measured repos instead of plotting them as zero', async () => {
    server.use(
      http.get('/api/v1/admin/storage/repos', () =>
        HttpResponse.json({
          items: [
            {
              id: 'r1',
              name: 'unmeasured',
              collection_id: 'c1',
              collection_name: 'Coll',
              local_path: '/repos/coll/unmeasured',
              size_bytes: null,
              git_size_bytes: null,
              worktree_bytes: null,
              size_computed_at: null,
            },
          ],
          total: 1,
          limit: 10,
          offset: 0,
        }),
      ),
    )

    renderAdmin()

    expect(
      await screen.findByText(/no clone sizes measured yet/i),
    ).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// The range-scoping contract
// ---------------------------------------------------------------------------

describe('Range filter', () => {
  it('lives in the header of the one card it scopes', async () => {
    /**
     * It used to be a page-level row above an "Over time" section. With only
     * LLM call volume windowed, a control sitting above every card would move
     * one of them and leave the reader guessing which numbers changed.
     */
    renderAdmin()

    const card = await screen.findByTestId('llm-volume')
    expect(within(card).getByTestId('overview-range-filter')).toBeInTheDocument()

    // And nowhere else on the page.
    expect(screen.getAllByTestId('overview-range-filter')).toHaveLength(1)
  })

  it('no longer splits the page into scoped and unscoped sections', async () => {
    renderAdmin()

    await screen.findByTestId('llm-volume')
    expect(screen.queryByText('Over time')).not.toBeInTheDocument()
    expect(screen.queryByText('Right now')).not.toBeInTheDocument()
  })

  it('refetches the time-scoped cards with the new window', async () => {
    const windows: string[] = []
    server.use(
      http.get('/api/v1/admin/llm-usage', ({ request }) => {
        windows.push(new URL(request.url).searchParams.get('days') ?? '')
        return HttpResponse.json({
          window_days: 7,
          total_calls: 0,
          by_model: [],
          daily: [],
          by_collection_owner: [],
          unattributed_summaries: 0,
          models_in_use: [],
          retired_models_in_use: [],
          current_default_model: 'claude-sonnet-5',
          generated_at: '2026-09-14T10:00:00Z',
        })
      }),
    )

    const user = userEvent.setup()
    renderAdmin()
    await screen.findByTestId('overview-range-filter')

    await user.click(screen.getByRole('button', { name: '7 days' }))

    await waitFor(() => expect(windows).toContain('7'))
  })

  it('marks the active window for assistive tech', async () => {
    const user = userEvent.setup()
    renderAdmin()

    await screen.findByTestId('overview-range-filter')
    const sevenDays = screen.getByRole('button', { name: '7 days' })
    await user.click(sevenDays)

    expect(sevenDays).toHaveAttribute('aria-pressed', 'true')
  })
})

// ---------------------------------------------------------------------------
// Resilience
// ---------------------------------------------------------------------------

describe('Partial failure', () => {
  it('costs one card rather than the whole dashboard', async () => {
    /**
     * The overview query gates the page because every section is framed
     * around its counts. The rest fail into their own cards, so one broken
     * endpoint must not blank out the page.
     */
    server.use(
      http.get('/api/v1/admin/pipeline', () => new HttpResponse(null, { status: 500 })),
    )

    renderAdmin()

    // Sync freshness comes from /admin/overview, so it survives a pipeline
    // outage — which is precisely when staleness is worth knowing.
    expect(await screen.findByTestId('sync-summary')).toHaveTextContent('2')
    expect(
      await screen.findByText(/could not load sync health/i),
    ).toBeInTheDocument()
  })

  it('still gates the page when the overview itself fails', async () => {
    server.use(
      http.get('/api/v1/admin/overview', () => new HttpResponse(null, { status: 500 })),
    )

    renderAdmin()

    expect(
      await screen.findByText(/could not load the instance overview/i),
    ).toBeInTheDocument()
  })
})
