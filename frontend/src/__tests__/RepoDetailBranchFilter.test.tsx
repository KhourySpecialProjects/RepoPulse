import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
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
}

// Commits using the new branches: string[] schema
const commitMain: Commit = {
  hash: 'aaa0000000001',
  author_name: 'Alice Johnson',
  author_email: 'alice@example.com',
  date: '2025-10-14T14:00:00Z',
  message: 'feat: main branch commit',
  branches: ['main'],
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

  it('renders multiple branch badges for a commit on multiple branches', async () => {
    setupHandlers()
    renderPage()
    await waitFor(() => expect(screen.getByText('merge: merged into main')).toBeInTheDocument())
    // commitMultiBranch has ['main', 'feature/auth'] — both badges should be in the DOM
    const featureAuthBadges = screen.getAllByText('feature/auth')
    expect(featureAuthBadges.length).toBeGreaterThan(0)
  })

  it('renders a branch filter chip row', async () => {
    setupHandlers()
    renderPage()
    await waitFor(() => expect(screen.getByText('student-project')).toBeInTheDocument())
    // Chip rows replaced the old <Select>, so there is no "All branches"
    // trigger any more: the row is a "Branch:" label, an "All" reset, and one
    // toggle per branch. "All" is not unique — the Author row has one too.
    expect(screen.getByText('Branch:')).toBeInTheDocument()
    expect(screen.getAllByText('All').length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: 'feature/auth' }).length).toBeGreaterThan(0)
  })

  it('shows all commits when no branch filter is selected', async () => {
    setupHandlers()
    renderPage()
    await waitFor(() => expect(screen.getByText('feat: main branch commit')).toBeInTheDocument())
    expect(screen.getByText('feat: feature branch commit')).toBeInTheDocument()
    expect(screen.getByText('merge: merged into main')).toBeInTheDocument()
  })
})
