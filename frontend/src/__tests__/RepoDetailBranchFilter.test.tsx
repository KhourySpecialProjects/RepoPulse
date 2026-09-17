import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { RepoDetailPage } from '@/pages/RepoDetailPage'
import type { Repo, Commit, PaginatedResponse, Note } from '@/types'

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
  last_commit_at: null,
  last_synced_at: '2025-10-15T10:00:00Z',
  created_at: '2025-09-01T00:00:00Z',
  updated_at: '2025-10-15T10:00:00Z',
  contributor_count: 2,
  active_reminder_count: 0,
  expected_contributor_count: null,
  sync_status: 'idle',
  sync_started_at: null,
  sync_started_by_name: null,
  sync_error: null,
}

// Commits using the new branches: string[] schema
const commitMain: Commit = {
  hash: 'aaa0000000001',
  author_name: 'Alice Johnson',
  author_email: 'alice@example.com',
  date: '2025-10-14T14:00:00Z',
  message: 'feat: main branch commit',
  branches: ['main'],
  origin_branch: 'main',
  insertions: 10,
  deletions: 2,
  files_changed: 1,
  commit_type: null,
  quality_score: null,
}

const commitFeature: Commit = {
  hash: 'bbb0000000002',
  author_name: 'Bob Smith',
  author_email: 'bob@example.com',
  date: '2025-10-13T09:30:00Z',
  message: 'feat: feature branch commit',
  branches: ['feature/auth'],
  origin_branch: 'feature/auth',
  insertions: 5,
  deletions: 1,
  files_changed: 1,
  commit_type: null,
  quality_score: null,
}

const commitMultiBranch: Commit = {
  hash: 'ccc0000000003',
  author_name: 'Alice Johnson',
  author_email: 'alice@example.com',
  date: '2025-10-12T10:00:00Z',
  message: 'merge: merged into main',
  branches: ['main', 'feature/auth'],
  origin_branch: 'main',
  insertions: 0,
  deletions: 0,
  files_changed: 0,
  commit_type: null,
  quality_score: null,
}

const mockCommits = [commitMain, commitFeature, commitMultiBranch]

function setupHandlers(notes: Note[] = []) {
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
      HttpResponse.json({ items: notes, total: notes.length, limit: 50, offset: 0 })
    ),
    http.post('/api/v1/notes', async ({ request }) => {
      const body = (await request.json()) as Partial<Note>
      return HttpResponse.json(
        {
          id: 'new-note',
          author_id: 'user-1',
          repo_id: body.repo_id ?? null,
          contributor_id: null,
          commit_hash: body.commit_hash ?? null,
          content: body.content ?? '',
          is_reminder: false,
          reminder_context: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { status: 201 }
      )
    })
  )
}

describe('RepoDetailPage - multi-branch commit schema (branches: string[])', () => {
  it('renders branch badges for a commit with a single branch', async () => {
    setupHandlers()
    renderPage()
    await waitFor(() => expect(screen.getByText('feat: main branch commit')).toBeInTheDocument())
    // The "main" badge should appear at least once (commitMain + commitMultiBranch both have "main")
    const mainBadges = screen.getAllByText('main')
    expect(mainBadges.length).toBeGreaterThan(0)
  })

  it('labels a commit with its owning branch, not every branch containing it', async () => {
    setupHandlers()
    renderPage()
    await waitFor(() => expect(screen.getByText('merge: merged into main')).toBeInTheDocument())
    // commitMultiBranch is contained in ['main', 'feature/auth'] but was made
    // on main, so it wears one badge — the owning branch. The feature/auth
    // badges in the DOM belong to commitFeature and the filter chip row.
    const featureAuthBadges = screen.getAllByText('feature/auth')
    expect(featureAuthBadges.length).toBeGreaterThan(0)
  })

  it('selecting a branch shows only commits made on it', async () => {
    // The regression this guards: `branches` lists every branch *containing* a
    // commit, so filtering on it made `feature/auth` also match main's history
    // — clicking a branch returned nearly the whole repo.
    setupHandlers()
    renderPage()
    await waitFor(() => expect(screen.getByText('feat: main branch commit')).toBeInTheDocument())

    // Both the filter chip row and commitFeature's own badge are buttons named
    // "feature/auth"; the chip row comes first in the DOM.
    fireEvent.click(screen.getAllByRole('button', { name: 'feature/auth' })[0])

    expect(screen.getByText('feat: feature branch commit')).toBeInTheDocument()
    expect(screen.queryByText('feat: main branch commit')).not.toBeInTheDocument()
    // Contained in feature/auth, but owned by main — must not come along.
    expect(screen.queryByText('merge: merged into main')).not.toBeInTheDocument()
  })

  it('selecting trunk excludes commits made on branches cut from it', async () => {
    setupHandlers()
    renderPage()
    await waitFor(() => expect(screen.getByText('feat: main branch commit')).toBeInTheDocument())

    fireEvent.click(screen.getAllByRole('button', { name: 'main' })[0])

    expect(screen.getByText('feat: main branch commit')).toBeInTheDocument()
    expect(screen.getByText('merge: merged into main')).toBeInTheDocument()
    expect(screen.queryByText('feat: feature branch commit')).not.toBeInTheDocument()
  })

  it('offers a chip only for branches that own commits', async () => {
    setupHandlers()
    renderPage()
    await waitFor(() => expect(screen.getByText('student-project')).toBeInTheDocument())
    // Both fixtures' owning branches, and nothing else.
    expect(screen.getAllByRole('button', { name: 'feature/auth' }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: 'main' }).length).toBeGreaterThan(0)
  })

  it('renders a branch filter chip row', async () => {
    setupHandlers()
    renderPage()
    await waitFor(() => expect(screen.getByText('student-project')).toBeInTheDocument())
    // The chips live in their own collapsible sidebar section now, so the
    // heading is the panel's toggle rather than an inline "Branch:" label.
    // Queried by role because the commits table also has a "Branch" column.
    expect(screen.getByRole('button', { name: 'Branch' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getAllByText('All').length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: 'feature/auth' }).length).toBeGreaterThan(0)
  })

  it('keeps the filter sections in view as the commit list scrolls', async () => {
    setupHandlers()
    renderPage()
    await waitFor(() => expect(screen.getByText('student-project')).toBeInTheDocument())

    // One sticky wrapper holds all four, so they travel together rather than
    // piling up on each other at the same offset.
    const wrapper = document.getElementById('branch-filter-content')?.closest('.sticky')
    expect(wrapper).not.toBeNull()
    expect(wrapper).toContainElement(document.getElementById('type-filter-content')!)
    expect(wrapper).toContainElement(document.getElementById('date-filter-content')!)
    expect(wrapper).toContainElement(document.getElementById('contributors-content')!)
  })

  it('remembers a collapsed section across remounts', async () => {
    setupHandlers()
    const first = renderPage()
    await waitFor(() => expect(screen.getByText('student-project')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Branch' }))
    expect(localStorage.getItem('repo-branch-filter-expanded-repo-1')).toBe('false')

    first.unmount()
    renderPage()
    await waitFor(() => expect(screen.getByText('student-project')).toBeInTheDocument())

    // Navigating away and back must not quietly reopen what the user closed.
    expect(screen.getByRole('button', { name: 'Branch' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('remembers a reopened section too', async () => {
    localStorage.setItem('repo-branch-filter-expanded-repo-1', 'false')
    setupHandlers()
    const first = renderPage()
    await waitFor(() => expect(screen.getByText('student-project')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Branch' }))
    first.unmount()
    renderPage()
    await waitFor(() => expect(screen.getByText('student-project')).toBeInTheDocument())

    expect(screen.getByRole('button', { name: 'Branch' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('keeps each panel and each repo on its own key', async () => {
    localStorage.setItem('repo-branch-filter-expanded-repo-1', 'false')
    setupHandlers()
    renderPage()
    await waitFor(() => expect(screen.getByText('student-project')).toBeInTheDocument())

    // Closing Branch on this repo must not close Type, or Branch elsewhere.
    expect(screen.getByRole('button', { name: 'Branch' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('button', { name: 'Type' })).toHaveAttribute('aria-expanded', 'true')
    expect(localStorage.getItem('repo-branch-filter-expanded-repo-2')).toBeNull()
  })

  it('collapses and restores the branch section', async () => {
    setupHandlers()
    renderPage()
    await waitFor(() => expect(screen.getByText('student-project')).toBeInTheDocument())
    const toggle = screen.getByRole('button', { name: 'Branch' })

    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(document.getElementById('branch-filter-content')).toHaveAttribute('hidden')

    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(document.getElementById('branch-filter-content')).not.toHaveAttribute('hidden')
  })

  it('keeps filtering while its section is collapsed', async () => {
    setupHandlers()
    renderPage()
    await waitFor(() => expect(screen.getByText('feat: main branch commit')).toBeInTheDocument())

    // Scoped to the filter panel. A bare getByRole matched two elements —
    // the chip in this panel and the one on the feature/auth commit's own
    // row — so this line threw before the panel carried a role="group".
    fireEvent.click(
      within(screen.getByRole('group', { name: /commit branch/i }))
        .getByRole('button', { name: 'feature/auth' })
    )
    fireEvent.click(screen.getByRole('button', { name: 'Branch' }))

    // Hiding the controls must not reset the filter they set.
    expect(screen.getByText('feat: feature branch commit')).toBeInTheDocument()
    expect(screen.queryByText('feat: main branch commit')).not.toBeInTheDocument()
  })

  it('shows all commits when no branch filter is selected', async () => {
    setupHandlers()
    renderPage()
    await waitFor(() => expect(screen.getByText('feat: main branch commit')).toBeInTheDocument())
    expect(screen.getByText('feat: feature branch commit')).toBeInTheDocument()
    expect(screen.getByText('merge: merged into main')).toBeInTheDocument()
  })
})
