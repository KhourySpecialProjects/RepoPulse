import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { RepoDetailPage } from '@/pages/RepoDetailPage'
import type { Repo } from '@/types'
import type { PRStats, PRListResponse } from '@/types'

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
    devLogin: () => Promise.resolve(),
    logout: () => {},
  }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}))

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

function renderPage(repoId = 'repo-1') {
  return render(
    <QueryClientProvider client={makeClient()}>
      <MemoryRouter initialEntries={[`/repos/${repoId}`]}>
        <Routes>
          <Route path="/repos/:id" element={<RepoDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

const mockRepo: Repo = {
  id: 'repo-1',
  collection_id: 'col-1',
  github_url: 'https://github.com/student/project',
  name: 'student-project',
  local_path: '/repos/student-project',
  health_status: 'green',
  health_score: null,
  last_synced_at: '2025-10-15T10:00:00Z',
  created_at: '2025-09-01T00:00:00Z',
  updated_at: '2025-10-15T10:00:00Z',
  contributor_count: 2,
  active_reminder_count: 0,
  expected_contributor_count: null,
}

const mockPRStats: PRStats = {
  open_count: 3,
  merged_last_30d: 7,
  avg_days_to_merge: 2.5,
  total_count: 15,
  fetched_at: '2026-03-28T10:00:00Z',
}

const mockPRListResponse: PRListResponse = {
  items: [
    {
      id: 'pr-1',
      repo_id: 'repo-1',
      pr_number: 42,
      title: 'feat: add user authentication',
      state: 'merged',
      author_login: 'alice-dev',
      created_at: '2026-03-01T10:00:00Z',
      merged_at: '2026-03-03T14:00:00Z',
      closed_at: null,
      html_url: 'https://github.com/student/project/pull/42',
      reviews_requested: 1,
      draft: false,
      fetched_at: '2026-03-28T10:00:00Z',
    },
    {
      id: 'pr-2',
      repo_id: 'repo-1',
      pr_number: 43,
      title: 'fix: resolve database connection issue',
      state: 'open',
      author_login: 'bob-dev',
      created_at: '2026-03-10T09:00:00Z',
      merged_at: null,
      closed_at: null,
      html_url: 'https://github.com/student/project/pull/43',
      reviews_requested: 0,
      draft: true,
      fetched_at: '2026-03-28T10:00:00Z',
    },
  ],
  total: 2,
  limit: 100,
  offset: 0,
  fetched_at: '2026-03-28T10:00:00Z',
}

describe('Pull Requests — PRStats row', () => {
  it('shows Fetch PRs button when no prStats', async () => {
    server.use(
      http.get('/api/v1/repos/:id', () => HttpResponse.json(mockRepo)),
      http.get('/api/v1/repos/:id/pull-requests/stats', () =>
        HttpResponse.json({ open_count: 0, merged_last_30d: 0, avg_days_to_merge: null, total_count: 0, fetched_at: null })
      ),
      http.get('/api/v1/repos/:id/pull-requests', () =>
        HttpResponse.json({ items: [], total: 0, limit: 100, offset: 0, fetched_at: null })
      ),
    )
    renderPage()
    await waitFor(() => expect(screen.getByText('student-project')).toBeInTheDocument())
    await waitFor(() => expect(screen.getByText('Fetch PRs')).toBeInTheDocument())
  })

  it('shows PR stat cards with counts when prStats has data', async () => {
    server.use(
      http.get('/api/v1/repos/:id', () => HttpResponse.json(mockRepo)),
      http.get('/api/v1/repos/:id/pull-requests/stats', () => HttpResponse.json(mockPRStats)),
      http.get('/api/v1/repos/:id/pull-requests', () => HttpResponse.json(mockPRListResponse)),
    )
    renderPage()
    await waitFor(() => expect(screen.getByText('student-project')).toBeInTheDocument())
    await waitFor(() => {
      expect(screen.getByText('Merged (30d)')).toBeInTheDocument()
      expect(screen.getByText('Avg Days to Merge')).toBeInTheDocument()
      expect(screen.getByText('Total PRs')).toBeInTheDocument()
    })
    // Check actual numbers — use specific values unlikely to appear elsewhere
    expect(screen.getByText('2.5')).toBeInTheDocument() // avg_days_to_merge
    expect(screen.getByText('15')).toBeInTheDocument()  // total_count
  })

  it('shows — for avg_days_to_merge when null', async () => {
    server.use(
      http.get('/api/v1/repos/:id', () => HttpResponse.json(mockRepo)),
      http.get('/api/v1/repos/:id/pull-requests/stats', () =>
        HttpResponse.json({ ...mockPRStats, avg_days_to_merge: null })
      ),
      http.get('/api/v1/repos/:id/pull-requests', () => HttpResponse.json(mockPRListResponse)),
    )
    renderPage()
    await waitFor(() => expect(screen.getByText('student-project')).toBeInTheDocument())
    await waitFor(() => expect(screen.getByText('Avg Days to Merge')).toBeInTheDocument())
    // "—" appears in the Avg Days to Merge stat card when value is null
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })
})

describe('Pull Requests — PR list section', () => {
  it('renders PR table with PR titles, authors and state pills', async () => {
    server.use(
      http.get('/api/v1/repos/:id', () => HttpResponse.json(mockRepo)),
      http.get('/api/v1/repos/:id/pull-requests/stats', () => HttpResponse.json(mockPRStats)),
      http.get('/api/v1/repos/:id/pull-requests', () => HttpResponse.json(mockPRListResponse)),
    )
    renderPage()
    await waitFor(() => expect(screen.getByText('student-project')).toBeInTheDocument())
    await waitFor(() => {
      expect(screen.getByText('feat: add user authentication')).toBeInTheDocument()
      expect(screen.getByText('fix: resolve database connection issue')).toBeInTheDocument()
    })
    expect(screen.getByText('alice-dev')).toBeInTheDocument()
    expect(screen.getByText('bob-dev')).toBeInTheDocument()
    // State pills — use getAllByText since "Open" also appears as a stat card label
    expect(screen.getByText('Merged')).toBeInTheDocument()
    expect(screen.getAllByText('Open').length).toBeGreaterThan(0)
  })

  it('marks draft PRs with [Draft] prefix', async () => {
    server.use(
      http.get('/api/v1/repos/:id', () => HttpResponse.json(mockRepo)),
      http.get('/api/v1/repos/:id/pull-requests/stats', () => HttpResponse.json(mockPRStats)),
      http.get('/api/v1/repos/:id/pull-requests', () => HttpResponse.json(mockPRListResponse)),
    )
    renderPage()
    await waitFor(() => expect(screen.getByText('student-project')).toBeInTheDocument())
    await waitFor(() => expect(screen.getByText('[Draft]')).toBeInTheDocument())
  })

  it('filters PRs by state when tab is clicked', async () => {
    server.use(
      http.get('/api/v1/repos/:id', () => HttpResponse.json(mockRepo)),
      http.get('/api/v1/repos/:id/pull-requests/stats', () => HttpResponse.json(mockPRStats)),
      http.get('/api/v1/repos/:id/pull-requests', ({ request }) => {
        const url = new URL(request.url)
        const state = url.searchParams.get('state')
        if (state === 'open') {
          return HttpResponse.json({
            items: [mockPRListResponse.items[1]],
            total: 1,
            limit: 100,
            offset: 0,
            fetched_at: '2026-03-28T10:00:00Z',
          })
        }
        return HttpResponse.json(mockPRListResponse)
      }),
    )
    renderPage()
    await waitFor(() => expect(screen.getByText('student-project')).toBeInTheDocument())
    await waitFor(() => expect(screen.getByText('feat: add user authentication')).toBeInTheDocument())

    // Click the "open" filter tab
    const openTab = screen.getByRole('button', { name: /^open$/i })
    fireEvent.click(openTab)

    await waitFor(() => {
      expect(screen.queryByText('feat: add user authentication')).not.toBeInTheDocument()
      expect(screen.getByText('fix: resolve database connection issue')).toBeInTheDocument()
    })
  })

  it('does not render PR list section when total is 0', async () => {
    server.use(
      http.get('/api/v1/repos/:id', () => HttpResponse.json(mockRepo)),
      http.get('/api/v1/repos/:id/pull-requests/stats', () =>
        HttpResponse.json({ open_count: 0, merged_last_30d: 0, avg_days_to_merge: null, total_count: 0, fetched_at: '2026-03-28T10:00:00Z' })
      ),
      http.get('/api/v1/repos/:id/pull-requests', () =>
        HttpResponse.json({ items: [], total: 0, limit: 100, offset: 0, fetched_at: '2026-03-28T10:00:00Z' })
      ),
    )
    renderPage()
    await waitFor(() => expect(screen.getByText('student-project')).toBeInTheDocument())
    await waitFor(() => expect(screen.getByText('No pull requests found.')).toBeInTheDocument())
    // PR list table should not be visible (there's still the commits table, so check PR-specific content absent)
    expect(screen.queryByText('feat: add user authentication')).not.toBeInTheDocument()
  })
})

describe('Pull Requests — sync mutation', () => {
  it('calls sync endpoint and shows Refresh PRs after data loads', async () => {
    let syncCalled = false
    server.use(
      http.get('/api/v1/repos/:id', () => HttpResponse.json(mockRepo)),
      // User with token configured so the sync button is enabled
      http.get('/api/v1/users/me', () =>
        HttpResponse.json({
          id: 'user-instructor-1',
          display_name: 'Instructor Mark',
          email: 'mark@example.com',
          role: 'instructor',
          github_token_configured: true,
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-01T00:00:00Z',
        })
      ),
      http.get('/api/v1/repos/:id/pull-requests/stats', () => HttpResponse.json(mockPRStats)),
      http.get('/api/v1/repos/:id/pull-requests', () => HttpResponse.json(mockPRListResponse)),
      http.post('/api/v1/repos/:id/pull-requests/sync', () => {
        syncCalled = true
        return HttpResponse.json({ synced: 5, repo_id: 'repo-1', fetched_at: new Date().toISOString() })
      }),
    )
    renderPage()
    await waitFor(() => expect(screen.getByText('student-project')).toBeInTheDocument())
    await waitFor(() => expect(screen.getByText('Refresh PRs')).toBeInTheDocument())

    const refreshBtn = screen.getByText('Refresh PRs')
    fireEvent.click(refreshBtn)

    await waitFor(() => expect(syncCalled).toBe(true))
  })
})
