/**
 * Date filtering in the Commits section.
 *
 * Fixture instants are chosen so the assertions hold in any timezone: two
 * commits share an exact instant (so they are always the same local day), and
 * the third is six days out (so it is never the same local day). The expected
 * filter value is derived with the same local-day rule the page uses rather
 * than hardcoded, for the same reason.
 */
import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { RepoDetailPage } from '@/pages/RepoDetailPage'
import type { Repo, Commit, PaginatedResponse } from '@/types'

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

/** The page's own local-day rule, mirrored so assertions are timezone-agnostic. */
function localKey(iso: string): string {
  const d = new Date(iso)
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${month}-${day}`
}

const DAY_ONE = '2026-09-14T12:00:00Z'
const DAY_TWO = '2026-09-20T12:00:00Z'

const mockRepo: Repo = {
  id: 'repo-1',
  collection_id: 'col-1',
  github_url: 'https://github.com/student/project',
  name: 'student-project',
  local_path: '/repos/student-project',
  health_status: 'green',
  health_score: null,
  last_commit_at: null,
  last_synced_at: '2026-09-20T10:00:00Z',
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-20T10:00:00Z',
  contributor_count: 1,
  active_reminder_count: 0,
  expected_contributor_count: null,
  sync_status: 'idle',
  sync_started_at: null,
  sync_started_by_name: null,
  sync_error: null,
}

function commit(hash: string, message: string, date: string): Commit {
  return {
    hash,
    author_name: 'Alice Johnson',
    author_email: 'alice@example.com',
    date,
    message,
    branches: ['main'],
    origin_branch: 'main',
    insertions: 3,
    deletions: 1,
    files_changed: 1,
    commit_type: null,
    quality_score: null,
  }
}

// Same instant for the first two: always the same local day, whatever TZ runs.
const mockCommits = [
  commit('aaa0000000001', 'feat: first on day one', DAY_ONE),
  commit('bbb0000000002', 'fix: second on day one', DAY_ONE),
  commit('ccc0000000003', 'chore: lone commit on day two', DAY_TWO),
]

function setupHandlers() {
  const commitResponse: PaginatedResponse<Commit> = {
    items: mockCommits,
    total: mockCommits.length,
    limit: 20,
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

function dateInput(): HTMLSelectElement {
  return screen.getByLabelText('Filter commits by date') as HTMLSelectElement
}

/** The visible label for a day: month and day, no year. */
function monthDay(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

describe('RepoDetailPage — commit date filter', () => {
  it('renders a date filter in the commits section', async () => {
    setupHandlers()
    renderPage()
    await waitFor(() => expect(screen.getByText('feat: first on day one')).toBeInTheDocument())

    expect(screen.getByText('Date:')).toBeInTheDocument()
    expect(dateInput()).toBeInTheDocument()
  })

  it('shows every commit until a date is chosen', async () => {
    setupHandlers()
    renderPage()
    await waitFor(() => expect(screen.getByText('feat: first on day one')).toBeInTheDocument())

    expect(screen.getByText('fix: second on day one')).toBeInTheDocument()
    expect(screen.getByText('chore: lone commit on day two')).toBeInTheDocument()
  })

  it('keeps only the commits made on the chosen day', async () => {
    setupHandlers()
    renderPage()
    await waitFor(() => expect(screen.getByText('feat: first on day one')).toBeInTheDocument())

    fireEvent.change(dateInput(), { target: { value: localKey(DAY_ONE) } })

    expect(screen.getByText('feat: first on day one')).toBeInTheDocument()
    expect(screen.getByText('fix: second on day one')).toBeInTheDocument()
    expect(screen.queryByText('chore: lone commit on day two')).not.toBeInTheDocument()
  })

  it('narrows to a single commit when only one was made that day', async () => {
    setupHandlers()
    renderPage()
    await waitFor(() => expect(screen.getByText('feat: first on day one')).toBeInTheDocument())

    fireEvent.change(dateInput(), { target: { value: localKey(DAY_TWO) } })

    expect(screen.getByText('chore: lone commit on day two')).toBeInTheDocument()
    expect(screen.queryByText('feat: first on day one')).not.toBeInTheDocument()
    expect(screen.queryByText('fix: second on day one')).not.toBeInTheDocument()
  })

  it('restores every commit when the filter goes back to All', async () => {
    setupHandlers()
    renderPage()
    await waitFor(() => expect(screen.getByText('feat: first on day one')).toBeInTheDocument())

    fireEvent.change(dateInput(), { target: { value: localKey(DAY_TWO) } })
    expect(screen.queryByText('feat: first on day one')).not.toBeInTheDocument()

    fireEvent.change(dateInput(), { target: { value: '' } })

    expect(screen.getByText('feat: first on day one')).toBeInTheDocument()
    expect(screen.getByText('fix: second on day one')).toBeInTheDocument()
    expect(screen.getByText('chore: lone commit on day two')).toBeInTheDocument()
  })

  it('offers only the days the repo has commits on, plus All', async () => {
    setupHandlers()
    renderPage()
    await waitFor(() => expect(screen.getByText('feat: first on day one')).toBeInTheDocument())

    // Two commits share DAY_ONE, so it must appear once, not twice.
    const values = Array.from(dateInput().options).map(o => o.value)
    expect(values).toEqual(['', localKey(DAY_TWO), localKey(DAY_ONE)])
  })

  it('labels each day with month and day only, no year', async () => {
    setupHandlers()
    renderPage()
    await waitFor(() => expect(screen.getByText('feat: first on day one')).toBeInTheDocument())

    const labels = Array.from(dateInput().options).map(o => o.textContent)
    expect(labels).toEqual(['All', monthDay(DAY_TWO), monthDay(DAY_ONE)])
    // e.g. "Sep 20", never "9/20/2026" or "Sep 20, 2026".
    labels.slice(1).forEach(label => expect(label).not.toMatch(/\d{4}/))
  })

  it('notes beside the dropdown that only days with commits are listed', async () => {
    setupHandlers()
    renderPage()
    await waitFor(() => expect(screen.getByText('feat: first on day one')).toBeInTheDocument())

    expect(screen.getByText('*only showing dates with commits')).toBeInTheDocument()
  })

  it('combines with the branch filter rather than replacing it', async () => {
    server.use(
      http.get('/api/v1/repos/:id', () => HttpResponse.json(mockRepo)),
      http.get('/api/v1/repos/:id/commits', () =>
        HttpResponse.json({
          items: [
            commit('aaa0000000001', 'feat: main on day one', DAY_ONE),
            { ...commit('ddd0000000004', 'feat: dev on day one', DAY_ONE), branches: ['dev'], origin_branch: 'dev' },
          ],
          total: 2,
          limit: 20,
          offset: 0,
        })
      ),
      http.get('/api/v1/repos/:id/contributors', () => HttpResponse.json([])),
      http.get('/api/v1/repos/:id/summaries', () => HttpResponse.json([])),
      http.get('/api/v1/notes', () =>
        HttpResponse.json({ items: [], total: 0, limit: 50, offset: 0 })
      )
    )
    renderPage()
    await waitFor(() => expect(screen.getByText('feat: main on day one')).toBeInTheDocument())

    // Same day, so the date filter alone keeps both.
    fireEvent.change(dateInput(), { target: { value: localKey(DAY_ONE) } })
    expect(screen.getByText('feat: main on day one')).toBeInTheDocument()
    expect(screen.getByText('feat: dev on day one')).toBeInTheDocument()

    // Adding the branch filter narrows within the day.
    fireEvent.click(screen.getAllByRole('button', { name: 'dev' })[0])
    expect(screen.getByText('feat: dev on day one')).toBeInTheDocument()
    expect(screen.queryByText('feat: main on day one')).not.toBeInTheDocument()
  })
})
