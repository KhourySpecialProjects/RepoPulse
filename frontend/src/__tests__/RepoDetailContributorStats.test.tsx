import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { RepoDetailPage } from '@/pages/RepoDetailPage'
import type { Commit, Contributor, PaginatedResponse, Repo } from '@/types'

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
  contributor_count: 1,
  active_reminder_count: 0,
  expected_contributor_count: null,
  last_commit_at: '2025-10-14T14:00:00Z',
}

// GitHub noreply addresses routinely carry the author's original capitalisation.
const MIXED_CASE_EMAIL = '12345+AliceJ@users.noreply.github.com'

const contributorWithMixedCaseAlias: Contributor[] = [
  {
    id: 'contrib-1',
    display_name: 'Alice Johnson',
    repo_id: 'repo-1',
    created_at: '2025-09-01T00:00:00Z',
    aliases: [{ id: 'alias-1', git_email: MIXED_CASE_EMAIL, git_name: 'AliceJ' }],
    commit_count: 2,
    total_insertions: 60,
    total_deletions: 10,
    last_commit_at: '2025-10-14T14:00:00Z',
  },
]

const commitsFromMixedCaseEmail: Commit[] = [
  {
    hash: 'aaa1111111111',
    author_name: 'AliceJ',
    author_email: MIXED_CASE_EMAIL,
    date: '2025-10-14T14:00:00Z',
    message: 'feat: add login form',
    branches: ['main'],
    insertions: 40,
    deletions: 6,
    files_changed: 3,
  },
  {
    hash: 'bbb2222222222',
    author_name: 'AliceJ',
    author_email: MIXED_CASE_EMAIL,
    date: '2025-10-13T09:30:00Z',
    message: 'fix: correct validation',
    branches: ['main'],
    insertions: 20,
    deletions: 4,
    files_changed: 1,
  },
]

function paginate(items: Commit[], total = items.length): PaginatedResponse<Commit> {
  return { items, total, limit: 500, offset: 0 }
}

describe('RepoDetailPage — contributor alias emails are matched case-insensitively', () => {
  it('shows the merged display name for commits whose author email differs only by case', async () => {
    server.use(
      http.get('/api/v1/repos/:id', () => HttpResponse.json(mockRepo)),
      http.get('/api/v1/repos/:id/contributors', () =>
        HttpResponse.json(contributorWithMixedCaseAlias)
      ),
      http.get('/api/v1/repos/:id/commits', () =>
        HttpResponse.json(paginate(commitsFromMixedCaseEmail))
      )
    )

    renderPage()

    await waitFor(() => expect(screen.getByText('student-project')).toBeInTheDocument())

    // The commits table must resolve the raw git author "AliceJ" to the merged
    // contributor "Alice Johnson"; otherwise merging aliases silently does nothing.
    await waitFor(() => {
      expect(screen.getAllByText('Alice Johnson').length).toBeGreaterThan(1)
    })
    expect(screen.queryByText('AliceJ')).not.toBeInTheDocument()
  })
})

describe('RepoDetailPage — contributor totals come from the backend aggregate', () => {
  it('shows the full commit_count even when only part of the history is loaded', async () => {
    // The repo has 900 commits; the page only ever loads the most recent 500,
    // so locally derived counts would undercount badly.
    const partialHistory: Contributor[] = [
      {
        id: 'contrib-1',
        display_name: 'Alice Johnson',
        repo_id: 'repo-1',
        created_at: '2025-09-01T00:00:00Z',
        aliases: [{ id: 'alias-1', git_email: 'alice@example.com', git_name: 'alice' }],
        commit_count: 900,
        total_insertions: 12000,
        total_deletions: 3400,
        last_commit_at: '2025-10-14T14:00:00Z',
      },
    ]

    const loadedSlice: Commit[] = [
      {
        hash: 'ccc3333333333',
        author_name: 'Alice Johnson',
        author_email: 'alice@example.com',
        date: '2025-10-14T14:00:00Z',
        message: 'feat: most recent commit',
        branches: ['main'],
        insertions: 10,
        deletions: 2,
        files_changed: 1,
      },
    ]

    server.use(
      http.get('/api/v1/repos/:id', () => HttpResponse.json(mockRepo)),
      http.get('/api/v1/repos/:id/contributors', () => HttpResponse.json(partialHistory)),
      http.get('/api/v1/repos/:id/commits', () =>
        HttpResponse.json(paginate(loadedSlice, 900))
      )
    )

    renderPage()

    await waitFor(() => expect(screen.getByText('student-project')).toBeInTheDocument())

    await waitFor(() => {
      expect(screen.getByText(/900 commits/)).toBeInTheDocument()
    })
    expect(screen.getByText(/\+12,000/)).toBeInTheDocument()
    expect(screen.getByText(/-3,400/)).toBeInTheDocument()
  })
})
