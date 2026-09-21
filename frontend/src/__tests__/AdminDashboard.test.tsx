/**
 * The admin dashboard shell: role guard, tab structure, and the tabs' content.
 *
 * vi.mock is hoisted to module scope by Vitest regardless of where it is
 * written, so useAuth is mocked deliberately at the top here rather than
 * inside an it() block as UserManagement.test.tsx does — there the mock
 * leaks across the whole file as a side effect.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { HttpResponse, delay, http } from 'msw'
import { toast } from 'sonner'
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

// The Toaster only mounts in main.tsx, so a real toast would go nowhere and be
// unassertable. Mocked at module scope for the same hoisting reason as useAuth.
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

beforeEach(() => {
  localStorage.clear()
  mockUser.role = 'admin'
  // Toast calls accumulate across tests otherwise, so a later assertion would
  // pass on an earlier test's call.
  vi.clearAllMocks()
})

describe('AdminPage shell', () => {
  it('redirects a non-admin away', () => {
    mockUser.role = 'instructor'

    renderAdmin()

    expect(screen.queryByRole('tab', { name: /overview/i })).not.toBeInTheDocument()
  })

  it('exposes its tabs with proper ARIA rather than plain buttons', () => {
    renderAdmin()

    const tabs = screen.getAllByRole('tab').map((tab) => tab.textContent)
    // One AI tab. The LLM Usage tab is gone: its token-and-cost card now sits
    // at the bottom of AI Settings, beside the rates it is priced at, and
    // call volume over time is on Overview's LLM Volume card.
    expect(tabs).toEqual(['Overview', 'Users', 'AI Settings'])
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

/**
 * The recalculate control.
 *
 * `POST /admin/storage/recalculate` and `useRecalculateAdminStorage` both
 * existed and were both tested, but no component ever called the hook — so
 * `AdminStatsService` never ran, `repos.size_bytes` stayed NULL, and the
 * figures read "0 B" with no way to clear it from the UI. These tests cover
 * the wiring that was missing, not the endpoint behind it.
 *
 * It sits in the Overview storage card now that the Storage tab is gone: that
 * card is the only place clone sizes are reported, so it is the only place the
 * staleness this button answers is visible.
 */
describe('Storage recalculate', () => {
  /** A storage response with the clone figures overridden. */
  function storageWith(
    clones: Partial<{
      measured_repos: number
      unmeasured_repos: number
      total_bytes: number
      git_bytes: number
      newest_measurement: string | null
    }>,
  ) {
    return {
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
        ...clones,
      },
      database_bytes: 1024,
      tables: [],
      drift: { orphan_directories: [], missing_clones: [], orphan_bytes: null },
      repo_root_dir: '/repos',
      generated_at: '2026-09-14T10:00:00Z',
    }
  }

  /** Overview is the default tab, so the card only has to be waited for. */
  async function openStorageCard() {
    const user = userEvent.setup()
    renderAdmin()
    await screen.findByTestId('capacity-clones')
    return user
  }

  it('offers a recalculate control, since nothing else ever measures a clone', async () => {
    await openStorageCard()

    expect(
      screen.getByRole('button', { name: /recalculate/i }),
    ).toBeInTheDocument()
  })

  it('replaces the stale figures with the freshly measured ones', async () => {
    // Keyed on whether the recalculate has actually run, not on how many
    // times the GET was called: several cards read /admin/storage, so a read
    // counter would be measuring the dashboard's fan-out rather than the
    // refresh this test is about.
    let measured = false
    server.use(
      http.get('/api/v1/admin/storage', () =>
        HttpResponse.json(
          measured
            ? storageWith({ measured_repos: 2, total_bytes: 3 * 1024 * 1024 })
            : storageWith({}),
        ),
      ),
      http.post('/api/v1/admin/storage/recalculate', () => {
        measured = true
        return HttpResponse.json({
          requested: 2,
          measured: 2,
          skipped_missing: 0,
          failed: 0,
          total_bytes: 3 * 1024 * 1024,
          duration_ms: 5,
          computed_at: '2026-09-14T10:05:00Z',
        })
      }),
    )

    const user = await openStorageCard()
    expect(screen.getByTestId('capacity-clones')).toHaveTextContent('0 B')

    await user.click(screen.getByRole('button', { name: /recalculate/i }))

    await waitFor(() =>
      expect(screen.getByTestId('capacity-clones')).toHaveTextContent('3 MB'),
    )
  })

  it('disables the control while the measurement is running', async () => {
    server.use(
      http.post('/api/v1/admin/storage/recalculate', async () => {
        await delay(50)
        return HttpResponse.json({
          requested: 1,
          measured: 1,
          skipped_missing: 0,
          failed: 0,
          total_bytes: 1024,
          duration_ms: 50,
          computed_at: '2026-09-14T10:00:00Z',
        })
      }),
    )

    const user = await openStorageCard()
    await user.click(screen.getByRole('button', { name: /recalculate/i }))

    // The endpoint is synchronous and walks every clone on the volume, so a
    // second click would start a second full walk of the same disk.
    expect(screen.getByRole('button', { name: /measuring/i })).toBeDisabled()

    // Settle before leaving. The mutation outlives the unmount otherwise, and
    // its toast fires during whichever test runs next — after beforeEach has
    // already cleared the mock, so that test reads this one's call as its own.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /recalculate/i })).toBeEnabled(),
    )
  })

  it('reports what was measured, skipped and failed', async () => {
    server.use(
      http.post('/api/v1/admin/storage/recalculate', () =>
        HttpResponse.json({
          requested: 5,
          measured: 3,
          skipped_missing: 1,
          failed: 1,
          total_bytes: 2 * 1024 * 1024,
          duration_ms: 90,
          computed_at: '2026-09-14T10:00:00Z',
        }),
      ),
    )

    const user = await openStorageCard()
    await user.click(screen.getByRole('button', { name: /recalculate/i }))

    await waitFor(() => expect(toast.success).toHaveBeenCalled())
    // All four numbers matter. "3 measured" on its own hides that two repos
    // the administrator expected to see counted were not measured at all.
    const message = String(vi.mocked(toast.success).mock.calls[0][0])
    expect(message).toContain('3 of 5')
    expect(message).toContain('2 MB')
    expect(message).toContain('1 clone missing')
    expect(message).toContain('1 failed')
  })

  it('does not mention skipped or failed when there were none', async () => {
    const user = await openStorageCard()

    await user.click(screen.getByRole('button', { name: /recalculate/i }))

    await waitFor(() => expect(toast.success).toHaveBeenCalled())
    const message = String(vi.mocked(toast.success).mock.calls[0][0])
    expect(message).toContain('2 of 2')
    expect(message).not.toMatch(/missing|failed/)
  })

  it('says so when the measurement fails, and stays usable', async () => {
    server.use(
      http.post('/api/v1/admin/storage/recalculate', () =>
        HttpResponse.json({ detail: 'boom' }, { status: 500 }),
      ),
    )

    const user = await openStorageCard()
    await user.click(screen.getByRole('button', { name: /recalculate/i }))

    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: /recalculate/i })).toBeEnabled()
  })
})

describe('Overview tab', () => {
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

    await screen.findByTestId('sync-summary')
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
    // Both endpoints, so the fixture is self-consistent: overriding only the
    // overview used to leave the pipeline still reporting four repos, which
    // is a state the backend cannot produce.
    server.use(
      http.get('/api/v1/admin/overview', () =>
        HttpResponse.json({
          ...overviewFixture,
          counts: { ...overviewFixture.counts, repos: 0 },
          health: { green: 0, yellow: 0, red: 0, unknown: 0 },
        }),
      ),
      http.get('/api/v1/admin/pipeline', () =>
        HttpResponse.json({
          sync_state: { idle: 0, syncing: 0, failed: 0 },
          sync_errors: [],
          sync_age: [
            { key: 'lt1d', label: 'Under a day', repos: 0 },
            { key: '1to3d', label: '1-3 days', repos: 0 },
            { key: '3to7d', label: '3-7 days', repos: 0 },
            { key: '7to30d', label: '7-30 days', repos: 0 },
            { key: 'gt30d', label: 'Over 30 days', repos: 0 },
            { key: 'never', label: 'Never synced', repos: 0 },
          ],
          coverage: [],
          generated_at: '2026-09-14T10:00:00Z',
        }),
      ),
    )

    renderAdmin()

    // An empty state, not an axis drawn around no data.
    expect(await screen.findByText(/no repositories yet/i)).toBeInTheDocument()
    expect(screen.queryByTestId('sync-age-chart')).not.toBeInTheDocument()
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
