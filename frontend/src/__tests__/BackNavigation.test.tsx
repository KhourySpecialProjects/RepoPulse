import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { RepoDetailPage } from '@/pages/RepoDetailPage'
import { DashboardPage } from '@/pages/DashboardPage'
import { RepoCard } from '@/components/RepoCard'
import type { Collection, Repo } from '@/types'

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

const navigate = vi.fn()
beforeEach(() => {
  navigate.mockClear()
  vi.mocked(useNavigate).mockReturnValue(navigate)
})

const mockRepo: Repo = {
  id: 'repo-1',
  collection_id: 'col-1',
  github_url: 'https://github.com/student/project',
  name: 'student-project',
  local_path: '/repos/student-project',
  health_status: 'yellow',
  health_score: null,
  last_synced_at: '2025-10-15T10:00:00Z',
  last_commit_at: '2025-10-14T14:00:00Z',
  created_at: '2025-09-01T00:00:00Z',
  updated_at: '2025-10-15T10:00:00Z',
  contributor_count: 2,
  active_reminder_count: 1,
  expected_contributor_count: null,
  sync_status: 'idle',
  sync_started_at: null,
  sync_started_by_name: null,
  sync_error: null,
}

const mockCollection: Collection = {
  id: 'col-1',
  name: 'Fall Capstone',
  course_tag: null,
  semester_tag: null,
  local_folder_name: 'fall-capstone',
  owner_id: 'user-test-1',
  created_at: '2025-09-01T00:00:00Z',
  updated_at: '2025-09-01T00:00:00Z',
  repo_count: 1,
  is_archived: false,
  health_green: 0,
  health_yellow: 1,
  health_red: 0,
  health_unknown: 0,
}

function repoHandlers() {
  server.use(
    http.get('/api/v1/repos/:id', () => HttpResponse.json(mockRepo)),
    http.get('/api/v1/repos/:id/health', () => HttpResponse.json(null)),
    http.get('/api/v1/repos/:id/commits', () =>
      HttpResponse.json({ items: [], total: 0, limit: 500, offset: 0 })
    ),
    http.get('/api/v1/repos/:id/contributors', () => HttpResponse.json([])),
    http.get('/api/v1/repos/:id/summaries', () => HttpResponse.json([])),
    http.get('/api/v1/notes', () =>
      HttpResponse.json({ items: [], total: 0, limit: 50, offset: 0 })
    )
  )
}

function renderRepoPage(entry: string | { pathname: string; state: unknown }) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/repos/:id" element={<RepoDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

/**
 * The back arrow used to always jump to the repo's collection, which was wrong
 * for every other way into the page — from the dashboard it sent you somewhere
 * you had never been.
 */
describe('RepoDetailPage back arrow', () => {
  it('returns to the collection when that is where the repo was opened from', async () => {
    repoHandlers()
    renderRepoPage({ pathname: '/repos/repo-1', state: { from: '/collections/col-1' } })

    const back = await screen.findByRole('button', { name: 'Back to collection' })
    await userEvent.click(back)

    expect(navigate).toHaveBeenCalledWith('/collections/col-1')
  })

  it('returns to the dashboard when the repo was opened from there', async () => {
    repoHandlers()
    renderRepoPage({ pathname: '/repos/repo-1', state: { from: '/' } })

    const back = await screen.findByRole('button', { name: 'Back to dashboard' })
    await userEvent.click(back)

    expect(navigate).toHaveBeenCalledWith('/')
  })

  it('returns to the notification list when the repo was opened from there', async () => {
    repoHandlers()
    renderRepoPage({ pathname: '/repos/repo-1', state: { from: '/notifications' } })

    await userEvent.click(await screen.findByRole('button', { name: 'Back to notifications' }))

    expect(navigate).toHaveBeenCalledWith('/notifications')
  })

  // Reloading the page or pasting the URL leaves no origin to return to, and
  // the collection is the only sensible guess.
  it('falls back to the collection on a direct visit', async () => {
    repoHandlers()
    renderRepoPage('/repos/repo-1')

    await userEvent.click(await screen.findByRole('button', { name: 'Back to collection' }))

    expect(navigate).toHaveBeenCalledWith('/collections/col-1')
  })
})

/** Reads back whatever origin a link recorded, so the pages can be tested. */
function OriginProbe() {
  const location = useLocation()
  const state = location.state as { from?: string } | null
  return <div data-testid="origin">{state?.from ?? 'none'}</div>
}

describe('pages record where they sent you from', () => {
  it('dashboard repo links record the dashboard', async () => {
    server.use(
      http.get('/api/v1/collections', () =>
        HttpResponse.json({ items: [mockCollection], total: 1, limit: 50, offset: 0 })
      ),
      http.get('/api/v1/collections/:id/repos', () =>
        HttpResponse.json({ items: [mockRepo], total: 1, limit: 50, offset: 0 })
      )
    )

    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/repos/:id" element={<OriginProbe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    )

    // The same repo appears in the attention list, the reminder list and the
    // recent table; they all link the same way, so the first one stands in.
    const links = await screen.findAllByRole('link', { name: /student-project/ })
    await userEvent.click(links[0])

    await waitFor(() => expect(screen.getByTestId('origin')).toHaveTextContent('/'))
  })

  it('a repo card records the collection page it sits on', async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/collections/col-1']}>
          <Routes>
            <Route path="/collections/:id" element={<RepoCard repo={mockRepo} />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    )

    await userEvent.click(screen.getByText('student-project'))

    expect(navigate).toHaveBeenCalledWith('/repos/repo-1', {
      state: { from: '/collections/col-1' },
    })
  })
})
