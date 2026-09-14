/**
 * The admin dashboard shell: role guard, tab structure, and the Storage tab.
 *
 * vi.mock is hoisted to module scope by Vitest regardless of where it is
 * written, so useAuth is mocked deliberately at the top here rather than
 * inside an it() block as UserManagement.test.tsx does — there the mock
 * leaks across the whole file as a side effect.
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
    user: mockUser.role ? { id: 'u1', display_name: 'Admin', role: mockUser.role } : null,
    isAuthenticated: true,
    isLoading: false,
  }),
}))

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

/**
 * Radix unmounts inactive tab panels, so Storage content does not exist
 * until its trigger is clicked.
 */
async function renderStorageTab() {
  const user = userEvent.setup()
  renderAdmin()
  await user.click(screen.getByRole('tab', { name: 'Storage' }))
}

beforeEach(() => {
  localStorage.clear()
  mockUser.role = 'admin'
})

describe('AdminPage shell', () => {
  it('redirects a non-admin away', () => {
    mockUser.role = 'instructor'

    renderAdmin()

    expect(screen.queryByRole('tab', { name: /storage/i })).not.toBeInTheDocument()
  })

  it('exposes its tabs with proper ARIA rather than plain buttons', () => {
    renderAdmin()

    const tabs = screen.getAllByRole('tab').map((tab) => tab.textContent)
    expect(tabs).toEqual(['Overview', 'Storage', 'Users', 'LLM Usage', 'System'])
  })

  it('opens on the Overview tab', () => {
    renderAdmin()

    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  it('switches tabs on click', async () => {
    const user = userEvent.setup()
    renderAdmin()

    await user.click(screen.getByRole('tab', { name: 'Users' }))

    expect(screen.getByRole('tab', { name: 'Users' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })
})

describe('Storage tab', () => {
  it('renders server storage figures from the API', async () => {
    await renderStorageTab()

    expect(await screen.findByTestId('database-total')).toHaveTextContent('12 MB')
    expect(screen.getByTestId('clone-total')).toHaveTextContent('3 MB')
  })

  it('reports free disk space', async () => {
    await renderStorageTab()

    const disk = await screen.findByTestId('disk-usage')
    expect(disk).toHaveTextContent('300 GB free')
    expect(disk).toHaveTextContent('40% used')
  })

  it('shows the real repo root from the server, not a per-user setting', async () => {
    await renderStorageTab()

    expect(await screen.findByText('/repos')).toBeInTheDocument()
  })

  it('lists the largest tables with exact row counts', async () => {
    await renderStorageTab()

    await screen.findByTestId('database-total')
    const table = screen.getAllByRole('table')[0]
    expect(within(table).getByText('commit_classifications')).toBeInTheDocument()
    // repos reports row_estimate 0 but row_count 3; the exact count wins.
    expect(within(table).getByText('3')).toBeInTheDocument()
  })

  it('surfaces drift in both directions', async () => {
    server.use(
      http.get('/api/v1/admin/storage', () =>
        HttpResponse.json({
          disk: {
            root: '/repos',
            exists: true,
            total_bytes: 100,
            used_bytes: 50,
            free_bytes: 50,
            percent_used: 50,
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
            orphan_directories: [{ path: '/repos/c/ghost', repo_id: null, repo_name: null, collection_name: null }],
            missing_clones: [{ path: '/repos/c/gone', repo_id: 'r1', repo_name: 'gone', collection_name: 'CS101' }],
            orphan_bytes: null,
          },
          repo_root_dir: '/repos',
          generated_at: '2026-09-14T10:00:00Z',
        }),
      ),
    )

    await renderStorageTab()

    const drift = await screen.findByTestId('drift')
    expect(drift).toHaveTextContent('1 clone on disk with no repo record')
    expect(drift).toHaveTextContent('1 repo with a missing clone')
  })

  it('reports an unmounted repo root rather than showing an empty disk', async () => {
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
          drift: { orphan_directories: [], missing_clones: [], orphan_bytes: null },
          repo_root_dir: '/repos',
          generated_at: '2026-09-14T10:00:00Z',
        }),
      ),
    )

    await renderStorageTab()

    expect(await screen.findByTestId('disk-missing')).toHaveTextContent(
      /not mounted/i,
    )
  })

  it('shows an error state with a retry rather than a blank panel', async () => {
    server.use(
      http.get('/api/v1/admin/storage', () =>
        HttpResponse.json({ detail: 'boom' }, { status: 500 }),
      ),
    )

    await renderStorageTab()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /could not load storage/i,
    )
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
  })

  it('shows the browser panel alongside the server one', async () => {
    localStorage.setItem('auth_token', 'abc')

    await renderStorageTab()

    expect(await screen.findByTestId('storage-scope-note')).toHaveTextContent(
      /this browser only/i,
    )
  })

  it('flags browser keys for repos the server no longer knows about', async () => {
    // repo-1 and repo-2 exist per the default handler; repo-999 does not.
    localStorage.setItem('repo-checkins-repo-999', '[1,2,3]')

    await renderStorageTab()

    expect(await screen.findByTestId('orphan-summary')).toHaveTextContent('1')
  })

  it('does not claim orphan knowledge when the repo list is incomplete', async () => {
    // total exceeds the returned page, so the live repo set is unknown.
    server.use(
      http.get('/api/v1/admin/storage/repos', () =>
        HttpResponse.json({ items: [], total: 500, limit: 200, offset: 0 }),
      ),
    )
    localStorage.setItem('repo-checkins-repo-999', '[1,2,3]')

    await renderStorageTab()

    await screen.findByTestId('storage-scope-note')
    await waitFor(() =>
      expect(screen.queryByTestId('orphan-summary')).not.toBeInTheDocument(),
    )
  })
})

describe('Overview tab', () => {
  it('shows instance-wide entity counts', async () => {
    renderAdmin()

    expect(await screen.findByTestId('metric-repos')).toHaveTextContent('4')
    expect(screen.getByTestId('metric-collections')).toHaveTextContent('2')
    expect(screen.getByTestId('metric-users')).toHaveTextContent('3')
    expect(screen.getByTestId('metric-contributors')).toHaveTextContent('7')
  })

  it('breaks users down by role', async () => {
    renderAdmin()

    expect(await screen.findByTestId('metric-users')).toHaveTextContent(
      '2 admin · 1 instructor · 0 TA',
    )
  })

  it('notes archived collections rather than hiding them in the total', async () => {
    renderAdmin()

    expect(await screen.findByTestId('metric-collections')).toHaveTextContent(
      '1 archived',
    )
  })

  it('renders all four health statuses including the zeros', async () => {
    renderAdmin()

    // unknown is 0 in the fixture and must still render — a chart that omits
    // a status when its count is zero misleads.
    expect(await screen.findByTestId('health-green')).toHaveTextContent('2')
    expect(screen.getByTestId('health-yellow')).toHaveTextContent('1')
    expect(screen.getByTestId('health-red')).toHaveTextContent('1')
    expect(screen.getByTestId('health-unknown')).toHaveTextContent('0')
  })

  it('splits sync freshness three ways', async () => {
    renderAdmin()

    const sync = await screen.findByTestId('sync-summary')
    expect(sync).toHaveTextContent('2')
    expect(sync).toHaveTextContent('fresh')
    expect(sync).toHaveTextContent('never synced')
  })

  it('explains that unsynced repos read as unknown, not unhealthy', async () => {
    renderAdmin()

    expect(await screen.findByTestId('stale-note')).toHaveTextContent(
      /operations problem, not a student one/i,
    )
  })

  it('warns when only one administrator exists', async () => {
    server.use(
      http.get('/api/v1/admin/overview', () =>
        HttpResponse.json({
          ...overviewFixture,
          counts: { ...overviewFixture.counts, admins: 1 },
        }),
      ),
    )

    renderAdmin()

    expect(await screen.findByTestId('admin-count-warning')).toHaveTextContent(
      /only one administrator/i,
    )
  })

  it('escalates when there are no administrators at all', async () => {
    server.use(
      http.get('/api/v1/admin/overview', () =>
        HttpResponse.json({
          ...overviewFixture,
          counts: { ...overviewFixture.counts, admins: 0 },
        }),
      ),
    )

    renderAdmin()

    const warning = await screen.findByTestId('admin-count-warning')
    expect(warning).toHaveTextContent(/no administrators/i)
    expect(warning).toHaveAttribute('role', 'alert')
  })

  it('stays quiet when there is more than one administrator', async () => {
    renderAdmin()

    await screen.findByTestId('metric-repos')
    expect(screen.queryByTestId('admin-count-warning')).not.toBeInTheDocument()
  })

  it('shows an error state with a retry rather than a blank page', async () => {
    server.use(
      http.get('/api/v1/admin/overview', () =>
        HttpResponse.json({ detail: 'boom' }, { status: 500 }),
      ),
    )

    renderAdmin()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /could not load the instance overview/i,
    )
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
  })

  it('handles an instance with no repositories', async () => {
    server.use(
      http.get('/api/v1/admin/overview', () =>
        HttpResponse.json({
          ...overviewFixture,
          counts: { ...overviewFixture.counts, repos: 0 },
          health: { green: 0, yellow: 0, red: 0, unknown: 0 },
        }),
      ),
    )

    renderAdmin()

    expect(await screen.findByText(/no repositories yet/i)).toBeInTheDocument()
  })
})

/** Mirrors the default MSW handler so overrides can vary one field. */
const overviewFixture = {
  counts: {
    users: 3,
    admins: 2,
    instructors: 1,
    tas: 0,
    collections: 2,
    archived_collections: 1,
    repos: 4,
    contributors: 7,
    notes: 5,
    note_comments: 2,
    summaries: 6,
    commit_classifications: 120,
    pull_requests: 9,
    notifications: 3,
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
    oldest_sync: '2026-08-01T09:00:00Z',
  },
  generated_at: '2026-09-14T10:00:00Z',
}

describe('System tab', () => {
  async function renderSystemTab() {
    const user = userEvent.setup()
    renderAdmin()
    await user.click(screen.getByRole('tab', { name: 'System' }))
  }

  it('shows the real REPO_ROOT_DIR from the server', async () => {
    await renderSystemTab()

    // Not AppSettings.repo_root_directory, which is per-user and never used
    // to build clone paths — the bug this tab used to have.
    expect(await screen.findByTestId('repo-root')).toHaveTextContent('/repos')
    expect(screen.getByTestId('repo-root-exists')).toHaveTextContent('Yes')
    expect(screen.getByTestId('repo-root-writable')).toHaveTextContent('Yes')
  })

  it('reports credentials as configured-or-not, never as values', async () => {
    await renderSystemTab()

    expect(await screen.findByTestId('anthropic-configured')).toHaveTextContent(
      'Configured',
    )
    expect(screen.getByTestId('github-configured')).toHaveTextContent(
      'Not configured',
    )
  })

  it('shows the applied and latest migration revisions', async () => {
    await renderSystemTab()

    expect(await screen.findByTestId('schema-revision')).toHaveTextContent('0005')
    expect(screen.getByTestId('schema-up-to-date')).toHaveTextContent('Yes')
  })

  it('warns when the schema is behind the latest migration', async () => {
    server.use(
      http.get('/api/v1/admin/system', () =>
        HttpResponse.json({
          ...systemFixture,
          schema_revision: '0002',
          schema_up_to_date: false,
          status: 'degraded',
        }),
      ),
    )

    await renderSystemTab()

    expect(await screen.findByTestId('schema-up-to-date')).toHaveTextContent(
      /alembic upgrade head/i,
    )
  })

  it('renders unknown rather than guessing when the revision cannot be read', async () => {
    server.use(
      http.get('/api/v1/admin/system', () =>
        HttpResponse.json({
          ...systemFixture,
          schema_revision: null,
          schema_up_to_date: null,
        }),
      ),
    )

    await renderSystemTab()

    expect(await screen.findByTestId('schema-up-to-date')).toHaveTextContent(
      'unknown',
    )
  })

  it('raises a loud banner when dev authentication is enabled', async () => {
    server.use(
      http.get('/api/v1/admin/system', () =>
        HttpResponse.json({
          ...systemFixture,
          auth_mode: 'dev',
          dev_login_enabled: true,
        }),
      ),
    )

    await renderSystemTab()

    const banner = await screen.findByTestId('dev-mode-banner')
    expect(banner).toHaveAttribute('role', 'alert')
    expect(banner).toHaveTextContent(/no password/i)
  })

  it('shows no dev banner in prod mode', async () => {
    await renderSystemTab()

    await screen.findByTestId('repo-root')
    expect(screen.queryByTestId('dev-mode-banner')).not.toBeInTheDocument()
  })

  it('flags a missing repo root', async () => {
    server.use(
      http.get('/api/v1/admin/system', () =>
        HttpResponse.json({
          ...systemFixture,
          repo_root_exists: false,
          repo_root_writable: false,
          status: 'degraded',
        }),
      ),
    )

    await renderSystemTab()

    expect(await screen.findByTestId('repo-root-exists')).toHaveTextContent('No')
  })

  it('shows an error state with a retry', async () => {
    server.use(
      http.get('/api/v1/admin/system', () =>
        HttpResponse.json({ detail: 'boom' }, { status: 500 }),
      ),
    )

    await renderSystemTab()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /could not load system status/i,
    )
  })
})

/** Mirrors the default MSW handler so overrides can vary one field. */
const systemFixture = {
  status: 'ok',
  server_time: '2026-09-14T10:00:00Z',
  database: 'ok',
  schema_revision: '0005',
  schema_head: '0005',
  schema_up_to_date: true,
  auth_mode: 'prod',
  dev_login_enabled: false,
  admin_count: 2,
  repo_root_dir: '/repos',
  repo_root_exists: true,
  repo_root_writable: true,
  anthropic_api_key_configured: true,
  github_token_configured: false,
  default_llm_provider: 'anthropic',
  default_llm_model: 'claude-sonnet-5',
  git_version: '2.43.0',
}

describe('LLM usage tab', () => {
  async function renderLlmTab() {
    const user = userEvent.setup()
    renderAdmin()
    await user.click(screen.getByRole('tab', { name: 'LLM Usage' }))
  }

  it('shows total calls and a per-model breakdown', async () => {
    await renderLlmTab()

    expect(await screen.findByTestId('llm-total')).toHaveTextContent('14')
    expect(screen.getByText('claude-sonnet-4-20250514')).toBeInTheDocument()
    expect(screen.getAllByText('claude-sonnet-5').length).toBeGreaterThan(0)
  })

  it('distinguishes summaries from commit classification', async () => {
    await renderLlmTab()

    await screen.findByTestId('llm-total')
    expect(screen.getByText('Commit classification')).toBeInTheDocument()
    // Two summary rows in the fixture — one per model.
    expect(screen.getAllByText('Summaries')).toHaveLength(2)
  })

  it('flags models that are not the current default', async () => {
    await renderLlmTab()

    expect(await screen.findByTestId('retired-models')).toHaveTextContent(
      'claude-sonnet-4-20250514',
    )
  })

  it('attributes usage to collection owners, labelled as such', async () => {
    await renderLlmTab()

    expect(await screen.findByTestId('llm-by-owner')).toHaveTextContent(
      'Instructor Mark',
    )
    expect(
      screen.getByText(/credits the collection owner, not/i),
    ).toBeInTheDocument()
  })

  it('reports summaries that cannot be attributed', async () => {
    await renderLlmTab()

    expect(await screen.findByTestId('unattributed')).toHaveTextContent('1')
  })

  it('shows no cost figure anywhere, and explains why', async () => {
    await renderLlmTab()

    const explainer = await screen.findByTestId('cost-explainer')
    expect(explainer).toHaveTextContent(/not recorded/i)
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument()
    expect(screen.queryByText(/\busd\b/i)).not.toBeInTheDocument()
  })

  it('links out to Phoenix for real token usage', async () => {
    await renderLlmTab()

    const link = await screen.findByTestId('phoenix-link')
    expect(link).toHaveAttribute('href', 'http://localhost:6006')
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('shows no failure count, because failures write no row', async () => {
    await renderLlmTab()

    await screen.findByTestId('llm-total')
    expect(screen.queryByText(/failure/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/\bfailed\b/i)).not.toBeInTheDocument()
  })

  it('switches the reporting window', async () => {
    const user = userEvent.setup()
    await renderLlmTab()
    await screen.findByTestId('llm-total')

    await user.click(screen.getByRole('button', { name: '7d' }))

    expect(screen.getByRole('button', { name: '7d' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('handles a window with no calls', async () => {
    server.use(
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

    await renderLlmTab()

    expect(await screen.findByText(/no llm calls in this window/i)).toBeInTheDocument()
  })

  it('shows an error state with a retry', async () => {
    server.use(
      http.get('/api/v1/admin/llm-usage', () =>
        HttpResponse.json({ detail: 'boom' }, { status: 500 }),
      ),
    )

    await renderLlmTab()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /could not load llm usage/i,
    )
  })
})
