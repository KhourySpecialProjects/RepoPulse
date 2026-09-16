/**
 * The left sidebar's filter panels: one surface colour, and present from the
 * first paint.
 *
 * Both problems were visible on every refresh. The Branch, Type and Date
 * panels were `bg-gray-50` while Pull Requests and Contributors beside them
 * were white, so the column read as two kinds of thing. And all three only
 * rendered once `allCommitsData` had arrived — the page body paints
 * immediately (the load state is just a progress bar at the top), so they
 * appeared a beat later and shoved the column down as they did.
 *
 * They still hide for a repo with genuinely nothing to filter. That was a
 * deliberate earlier decision — an empty Branch panel is a dead header — and
 * "don't pop in while loading" is a different problem from "don't show a
 * panel with nothing in it".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse, delay } from 'msw'
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

/** @param commits null to hold the commits request open indefinitely. */
function setupHandlers(commits: Commit[] | null) {
  server.use(
    http.get('/api/v1/repos/:id', () => HttpResponse.json(mockRepo)),
    http.get('/api/v1/repos/:id/commits', async () => {
      if (commits === null) {
        await delay('infinite')
        return HttpResponse.json({})
      }
      const body: PaginatedResponse<Commit> = {
        items: commits,
        total: commits.length,
        limit: 500,
        offset: 0,
      }
      return HttpResponse.json(body)
    }),
    http.get('/api/v1/repos/:id/contributors', () => HttpResponse.json([])),
    http.get('/api/v1/repos/:id/summaries', () => HttpResponse.json([])),
    http.get('/api/v1/notes', () =>
      HttpResponse.json({ items: [], total: 0, limit: 50, offset: 0 })
    )
  )
}

function renderPage() {
  return render(
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
}

/** A filter panel's outer card, found via its heading toggle. */
function panel(name: RegExp): HTMLElement {
  const heading = screen.getByRole('button', { name })
  return heading.closest('div.rounded-xl') as HTMLElement
}

const PANELS: [string, RegExp][] = [
  ['Branch', /^branch$/i],
  ['Type', /^type$/i],
  ['Date', /^date$/i],
]

beforeEach(() => {
  for (const key of ['branch', 'type', 'date', 'contributors', 'pull-requests', 'activity']) {
    localStorage.removeItem(`repo-${key}-filter-expanded-repo-1`)
    localStorage.removeItem(`repo-${key}-expanded-repo-1`)
  }
})

describe('panel surface colour', () => {
  it.each(PANELS)('renders the %s panel white, not grey', async (_label, name) => {
    setupHandlers([mockCommit])
    renderPage()
    await waitFor(() => expect(screen.getByRole('button', { name })).toBeInTheDocument())

    expect(panel(name).className).toContain('bg-card')
    expect(panel(name).className).not.toContain('bg-gray-50')
  })

  it('matches the Contributors panel beside it', async () => {
    // The point of the change: one column, one surface.
    setupHandlers([mockCommit])
    renderPage()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^branch$/i })).toBeInTheDocument()
    )

    const contributors = panel(/^contributors$/i)
    expect(panel(/^branch$/i).className).toContain('bg-card')
    expect(contributors.className).toContain('bg-card')
  })
})

describe('present from the first paint', () => {
  it.each(PANELS)('shows the %s panel while commits are still loading', async (_label, name) => {
    setupHandlers(null)
    renderPage()

    // Nothing to wait for: the panel must be in the very first render that
    // has a repo, not appear once the commit list resolves.
    await waitFor(() =>
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    )
  })

  it('marks the loading panels as busy rather than showing empty controls', async () => {
    setupHandlers(null)
    renderPage()

    await waitFor(() =>
      expect(screen.getAllByRole('status', { name: /loading filters/i }).length)
        .toBeGreaterThan(0)
    )
  })

  it('does not offer a filter control until there is something to filter', async () => {
    setupHandlers(null)
    renderPage()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^type$/i })).toBeInTheDocument()
    )

    // A chip row that is empty and then fills in is its own layout shift.
    expect(
      screen.queryByRole('group', { name: /commit type/i })
    ).not.toBeInTheDocument()
  })

  it('swaps the placeholder for real controls once commits arrive', async () => {
    setupHandlers([mockCommit])
    renderPage()

    await waitFor(() =>
      expect(screen.getByRole('group', { name: /commit type/i })).toBeInTheDocument()
    )
    expect(screen.queryByRole('status', { name: /loading filters/i })).not.toBeInTheDocument()
  })
})

describe('a repo with nothing to filter', () => {
  it('hides the panels once loading has finished empty', async () => {
    // Still the earlier decision: an empty Branch panel is a dead header.
    // "Do not pop in while loading" is a different problem from that.
    setupHandlers([])
    renderPage()

    await waitFor(() =>
      expect(screen.queryByRole('status', { name: /loading filters/i })).not.toBeInTheDocument()
    )
    expect(screen.queryByRole('button', { name: /^branch$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^type$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^date$/i })).not.toBeInTheDocument()
  })
})
