/**
 * The Commits card's loading state.
 *
 * The commits handler returns a promise that never settles, so the query stays
 * pending for the life of each test. That exercises the real component rather
 * than a mocked hook, and it is what surfaced the bug this state fixes: while
 * the request was in flight the card rendered "No commits found."
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { RepoDetailPage } from '@/pages/RepoDetailPage'
import type { Repo } from '@/types'

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

const mockRepo: Repo = {
  id: 'repo-1',
  collection_id: 'col-1',
  github_url: 'https://github.com/student/project',
  name: 'student-project',
  local_path: '/repos/student-project',
  health_status: 'green',
  health_score: null,
  last_commit_at: null,
  last_synced_at: '2026-09-14T10:00:00Z',
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-14T10:00:00Z',
  contributor_count: 1,
  active_reminder_count: 0,
  expected_contributor_count: null,
  sync_status: 'idle',
  sync_started_at: null,
  sync_started_by_name: null,
  sync_error: null,
}

function setupPendingCommits() {
  server.use(
    http.get('/api/v1/repos/:id', () => HttpResponse.json(mockRepo)),
    // Never settles: the commits query stays in its loading state.
    http.get('/api/v1/repos/:id/commits', () => new Promise<never>(() => {})),
    http.get('/api/v1/repos/:id/contributors', () => HttpResponse.json([])),
    http.get('/api/v1/repos/:id/summaries', () => HttpResponse.json([])),
    http.get('/api/v1/notes', () =>
      HttpResponse.json({ items: [], total: 0, limit: 50, offset: 0 })
    )
  )
}

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/repos/repo-1']}>
        <Routes>
          <Route path="/repos/:id" element={<RepoDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

afterEach(() => vi.useRealTimers())

describe('RepoDetailPage — commits loading state', () => {
  it('shows a loading indicator while commits are in flight', async () => {
    setupPendingCommits()
    renderPage()

    expect(await screen.findByRole('status', { name: 'Loading commits' })).toBeInTheDocument()
  })

  it('does not claim there are no commits while still loading', async () => {
    setupPendingCommits()
    renderPage()
    await screen.findByRole('status', { name: 'Loading commits' })

    // The regression: an undefined result read as an empty one.
    expect(screen.queryByText('No commits found.')).not.toBeInTheDocument()
  })

  it('spins a circle rather than only printing text', async () => {
    setupPendingCommits()
    const { container } = renderPage()
    await screen.findByRole('status', { name: 'Loading commits' })

    expect(container.querySelector('.animate-spin')).not.toBeNull()
  })

  it('shows a progress bar alongside the spinner', async () => {
    setupPendingCommits()
    renderPage()
    await screen.findByRole('status', { name: 'Loading commits' })

    expect(screen.getByRole('progressbar', { name: 'Commits loading progress' })).toBeInTheDocument()
  })

  it('advances that progress bar as the wait goes on', async () => {
    setupPendingCommits()
    renderPage()
    await screen.findByRole('status', { name: 'Loading commits' })
    const bar = screen.getByRole('progressbar', { name: 'Commits loading progress' })

    expect(bar).toHaveAttribute('aria-valuenow', '0')
    await waitFor(() => expect(Number(bar.getAttribute('aria-valuenow'))).toBeGreaterThan(0))
  })

  it('keeps the spinner out of the accessibility tree', async () => {
    setupPendingCommits()
    const { container } = renderPage()
    await screen.findByRole('status', { name: 'Loading commits' })

    // Decoration: the status label and the progress bar carry the meaning.
    expect(container.querySelector('.animate-spin')).toHaveAttribute('aria-hidden', 'true')
  })

  it('stops the spinner for users who asked for reduced motion', async () => {
    setupPendingCommits()
    const { container } = renderPage()
    await screen.findByRole('status', { name: 'Loading commits' })

    expect(container.querySelector('.animate-spin')).toHaveClass('motion-reduce:animate-none')
  })
})
