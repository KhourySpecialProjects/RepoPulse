/**
 * The sidebar filters reach the Commit Activity graph, not just the table.
 *
 * Before this, clicking "Logistical" narrowed the list to two commits while
 * the graph above it kept drawing all forty — two contradictory answers to
 * the same question on one screen.
 *
 * Wiring test: the per-filter behaviour of the graph itself lives in
 * ContextualActivityChartFilters.test.tsx. What matters here is that the
 * page's own filter state actually arrives, keyed to the same commits the
 * table is showing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { RepoDetailPage } from '@/pages/RepoDetailPage'
import type { Commit, PaginatedResponse, Repo } from '@/types'

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: vi.fn() }
})

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'user-test-1', display_name: 'Test User', role: 'instructor' as const },
    isAuthenticated: true,
    isLoading: false,
    login: () => Promise.resolve(),
    logout: () => {},
  }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}))

/** Captures what the page hands the chart, so the wiring is observable. */
const chartProps: Record<string, unknown>[] = []
vi.mock('@/components/ContextualActivityChart', () => ({
  ContextualActivityChart: (props: Record<string, unknown>) => {
    chartProps.push(props)
    return <div data-testid="activity-chart" />
  },
}))

function latest() {
  return chartProps[chartProps.length - 1]
}

/** The graph's series as date→count, or null when unfiltered. */
function series(): Record<string, number> | null {
  const override = latest()?.activityOverride as
    | { date: string; count: number }[]
    | null
    | undefined
  if (override == null) return null
  return Object.fromEntries(override.map((p) => [p.date, p.count]))
}

const mockRepo: Repo = {
  id: 'repo-1',
  collection_id: 'col-1',
  github_url: 'https://github.com/student/project',
  name: 'student-project',
  local_path: '/repos/student-project',
  health_status: 'green',
  health_score: null,
  last_synced_at: '2026-09-15T10:00:00Z',
  last_commit_at: '2026-09-14T14:00:00Z',
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-15T10:00:00Z',
  contributor_count: 1,
  active_reminder_count: 0,
  expected_contributor_count: null,
  sync_status: 'idle',
  sync_started_at: null,
  sync_started_by_name: null,
  sync_error: null,
}

function commit(
  overrides: Partial<Commit> & Pick<Commit, 'hash' | 'message'>
): Commit {
  return {
    author_name: 'Alice Johnson',
    author_email: 'alice@example.com',
    // Midday local, so the local calendar day is unambiguous whatever the
    // runner's timezone — these dates are asserted on directly.
    date: '2026-09-10T12:00:00',
    branches: ['main'],
    origin_branch: 'main',
    insertions: 10,
    deletions: 2,
    files_changed: 1,
    commit_type: null,
    quality_score: null,
    ...overrides,
  }
}

const COMMITS = [
  commit({ hash: 'a'.repeat(13), message: 'feat: real work', commit_type: 'substantive', date: '2026-09-10T12:00:00' }),
  commit({ hash: 'b'.repeat(13), message: 'feat: more work', commit_type: 'substantive', date: '2026-09-10T15:00:00' }),
  commit({ hash: 'c'.repeat(13), message: 'docs: housekeeping', commit_type: 'logistical', date: '2026-09-11T12:00:00' }),
  commit({ hash: 'd'.repeat(13), message: 'chore: on a branch', commit_type: 'logistical', origin_branch: 'feature/auth', date: '2026-09-12T12:00:00' }),
]

function setupHandlers() {
  const commitResponse: PaginatedResponse<Commit> = {
    items: COMMITS,
    total: COMMITS.length,
    limit: 500,
    offset: 0,
  }
  server.use(
    http.get('/api/v1/repos/:id', () => HttpResponse.json(mockRepo)),
    http.get('/api/v1/repos/:id/commits', () => HttpResponse.json(commitResponse)),
    http.get('/api/v1/repos/:id/contributors', () => HttpResponse.json([])),
    http.get('/api/v1/repos/:id/summaries', () => HttpResponse.json([])),
    http.get('/api/v1/notes', () =>
      HttpResponse.json({ items: [], total: 0, limit: 50, offset: 0 })
    )
  )
}

async function renderAndWait() {
  setupHandlers()
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={['/repos/repo-1']}>
        <Routes>
          <Route path="/repos/:id" element={<RepoDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
  await waitFor(() =>
    expect(screen.getByText('feat: real work')).toBeInTheDocument()
  )
}

const typeFilter = () =>
  within(screen.getByRole('group', { name: /commit type/i }))
const dateFilter = () =>
  within(screen.getByRole('group', { name: /commit date/i }))
/** Scoped: every commit row also renders a chip for its own branch, so a
 *  bare getByRole for a branch name matches the row chip as well. */
const branchFilter = () =>
  within(screen.getByRole('group', { name: /commit branch/i }))

beforeEach(() => {
  chartProps.length = 0
})

describe('type filter', () => {
  it('leaves the graph alone until a type is chosen', async () => {
    await renderAndWait()

    // null, not an empty array: the chart falls back to the repo's own full
    // history, which reaches further back than this page's commit list.
    expect(series()).toBeNull()
    expect(latest()?.filterLabel).toBeUndefined()
  })

  it('narrows the graph to the selected type', async () => {
    await renderAndWait()
    fireEvent.click(typeFilter().getByRole('button', { name: 'Logistical' }))

    await waitFor(() => expect(series()).not.toBeNull())
    // Only the two logistical commits, on their own days.
    expect(series()).toEqual({ '2026-09-11': 1, '2026-09-12': 1 })
  })

  it('counts several commits on one day as that day’s total', async () => {
    await renderAndWait()
    fireEvent.click(typeFilter().getByRole('button', { name: 'Substantive' }))

    await waitFor(() => expect(series()).toEqual({ '2026-09-10': 2 }))
  })

  it('labels the graph with the type so smaller numbers are explained', async () => {
    await renderAndWait()
    fireEvent.click(typeFilter().getByRole('button', { name: 'Logistical' }))

    await waitFor(() => expect(latest()?.filterLabel).toBe('Logistical'))
  })

  it('releases the graph when All is clicked again', async () => {
    await renderAndWait()
    fireEvent.click(typeFilter().getByRole('button', { name: 'Logistical' }))
    await waitFor(() => expect(series()).not.toBeNull())

    fireEvent.click(typeFilter().getByRole('button', { name: 'All' }))

    await waitFor(() => expect(series()).toBeNull())
  })
})

describe('branch filter', () => {
  it('narrows the graph to the selected branch', async () => {
    await renderAndWait()
    fireEvent.click(branchFilter().getByRole('button', { name: 'feature/auth' }))

    await waitFor(() => expect(series()).toEqual({ '2026-09-12': 1 }))
  })

  it('names the branch in the label', async () => {
    await renderAndWait()
    fireEvent.click(branchFilter().getByRole('button', { name: 'feature/auth' }))

    await waitFor(() =>
      expect(latest()?.filterLabel).toBe('on feature/auth')
    )
  })

  it('combines with the type filter rather than replacing it', async () => {
    await renderAndWait()
    fireEvent.click(typeFilter().getByRole('button', { name: 'Substantive' }))
    fireEvent.click(branchFilter().getByRole('button', { name: 'feature/auth' }))

    // The only branch commit is logistical, so the intersection is empty —
    // an empty array, which the chart reports as "no commits match" rather
    // than as a repo with no history.
    await waitFor(() => expect(series()).toEqual({}))
  })
})

describe('date filter', () => {
  it('highlights the day instead of filtering the series', async () => {
    await renderAndWait()
    fireEvent.change(dateFilter().getByLabelText(/filter commits by date/i), {
      target: { value: '2026-09-11' },
    })

    await waitFor(() => expect(latest()?.highlightDate).toBe('2026-09-11'))
    // Series untouched: a single day's count means nothing without the days
    // around it for comparison.
    expect(series()).toBeNull()
  })

  it('passes no highlight when the date filter is cleared', async () => {
    await renderAndWait()
    const select = dateFilter().getByLabelText(/filter commits by date/i)
    fireEvent.change(select, { target: { value: '2026-09-11' } })
    await waitFor(() => expect(latest()?.highlightDate).toBe('2026-09-11'))

    fireEvent.change(select, { target: { value: '' } })

    await waitFor(() => expect(latest()?.highlightDate).toBeUndefined())
  })

  it('still narrows the table to that day', async () => {
    // The graph highlights, the list filters. Both are intended, and the
    // table's existing behaviour must not have been traded away for it.
    await renderAndWait()
    fireEvent.change(dateFilter().getByLabelText(/filter commits by date/i), {
      target: { value: '2026-09-11' },
    })

    await waitFor(() =>
      expect(screen.queryByText('feat: real work')).not.toBeInTheDocument()
    )
    expect(screen.getByText('docs: housekeeping')).toBeInTheDocument()
  })

  it('highlights and narrows at the same time when combined with a type', async () => {
    await renderAndWait()
    fireEvent.click(typeFilter().getByRole('button', { name: 'Logistical' }))
    fireEvent.change(dateFilter().getByLabelText(/filter commits by date/i), {
      target: { value: '2026-09-11' },
    })

    await waitFor(() => expect(latest()?.highlightDate).toBe('2026-09-11'))
    // The series carries both logistical days; only the table drops to one.
    expect(series()).toEqual({ '2026-09-11': 1, '2026-09-12': 1 })
  })
})
