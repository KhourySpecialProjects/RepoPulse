/**
 * The Commit Activity card's collapsed state survives, per repo.
 *
 * The graph is the tallest thing on the page, so someone who collapses it to
 * reach the commits table wants it to stay collapsed — otherwise every visit
 * undoes the choice. It uses the same `usePersistedPanel` storage the branch,
 * type, date, contributors and pull-requests panels already use, keyed by repo
 * so collapsing it on one project does not collapse it on another.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
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

const STORAGE_KEY = 'repo-activity-expanded-repo-1'

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

const mockCommit: Commit = {
  hash: 'abc1234567890',
  author_name: 'Alice Johnson',
  author_email: 'alice@example.com',
  date: '2026-09-14T14:00:00Z',
  message: 'feat: implement auth',
  branches: ['main'],
  origin_branch: 'main',
  insertions: 10,
  deletions: 2,
  files_changed: 1,
  commit_type: null,
  quality_score: null,
}

beforeEach(() => {
  localStorage.removeItem(STORAGE_KEY)
  localStorage.removeItem('repo-activity-expanded-repo-2')
  const commits: PaginatedResponse<Commit> = {
    items: [mockCommit],
    total: 1,
    limit: 500,
    offset: 0,
  }
  server.use(
    http.get('/api/v1/repos/:id', () => HttpResponse.json(mockRepo)),
    http.get('/api/v1/repos/:id/commits', () => HttpResponse.json(commits)),
    http.get('/api/v1/repos/:id/contributors', () => HttpResponse.json([])),
    http.get('/api/v1/repos/:id/summaries', () => HttpResponse.json([])),
    http.get('/api/v1/notes', () =>
      HttpResponse.json({ items: [], total: 0, limit: 50, offset: 0 })
    )
  )
})

function renderPage(repoId = 'repo-1') {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[`/repos/${repoId}`]}>
        <Routes>
          <Route path="/repos/:id" element={<RepoDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

const toggle = () => screen.getByRole('button', { name: /commit activity/i })

async function renderAndWait(repoId = 'repo-1') {
  const result = renderPage(repoId)
  await waitFor(() => expect(toggle()).toBeInTheDocument())
  return result
}

describe('RepoDetailPage — collapsing the activity graph', () => {
  it('opens expanded on a first visit', async () => {
    await renderAndWait()

    expect(toggle()).toHaveAttribute('aria-expanded', 'true')
  })

  it('collapses on click', async () => {
    await renderAndWait()

    fireEvent.click(toggle())

    await waitFor(() =>
      expect(toggle()).toHaveAttribute('aria-expanded', 'false')
    )
  })

  it('expands again on a second click', async () => {
    await renderAndWait()

    fireEvent.click(toggle())
    await waitFor(() =>
      expect(toggle()).toHaveAttribute('aria-expanded', 'false')
    )
    fireEvent.click(toggle())

    await waitFor(() =>
      expect(toggle()).toHaveAttribute('aria-expanded', 'true')
    )
  })

  it('remembers being collapsed across a remount', async () => {
    const { unmount } = await renderAndWait()
    fireEvent.click(toggle())
    await waitFor(() => expect(localStorage.getItem(STORAGE_KEY)).toBe('false'))
    unmount()

    await renderAndWait()

    // The whole point: collapsing it once should not have to be redone on
    // every visit to the project.
    expect(toggle()).toHaveAttribute('aria-expanded', 'false')
  })

  it('keeps the choice scoped to the repo it was made on', async () => {
    const { unmount } = await renderAndWait()
    fireEvent.click(toggle())
    await waitFor(() => expect(localStorage.getItem(STORAGE_KEY)).toBe('false'))
    unmount()

    await renderAndWait('repo-2')

    expect(toggle()).toHaveAttribute('aria-expanded', 'true')
  })

  it('still shows the commits table while the graph is collapsed', async () => {
    // Collapsing the graph is how someone reaches the table faster, so the
    // table had better still be there.
    await renderAndWait()
    fireEvent.click(toggle())

    await waitFor(() =>
      expect(toggle()).toHaveAttribute('aria-expanded', 'false')
    )
    expect(screen.getByText('feat: implement auth')).toBeInTheDocument()
  })

  it('survives browser storage being unavailable', async () => {
    // Safari in private mode throws on setItem. The toggle must still work
    // for the rest of the session rather than taking the page down.
    const setItem = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('QuotaExceededError')
      })

    await renderAndWait()
    fireEvent.click(toggle())

    await waitFor(() =>
      expect(toggle()).toHaveAttribute('aria-expanded', 'false')
    )
    setItem.mockRestore()
  })
})
