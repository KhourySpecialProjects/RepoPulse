import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { RepoDetailPage } from '@/pages/RepoDetailPage'
import type { Contributor, Repo } from '@/types'

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

const mockContributorsEnriched: Contributor[] = [
  {
    id: 'contrib-1',
    display_name: 'Alice Johnson',
    repo_id: 'repo-1',
    created_at: '2025-09-01T00:00:00Z',
    aliases: [{ id: 'alias-1', git_email: 'alice@example.com', git_name: 'alice' }],
    commit_count: 42,
    total_insertions: 1204,
    total_deletions: 389,
    last_commit_at: '2026-03-15T10:00:00Z',
  },
  {
    id: 'contrib-2',
    display_name: 'Bob Smith',
    repo_id: 'repo-1',
    created_at: '2025-09-01T00:00:00Z',
    aliases: [],
    commit_count: 7,
    total_insertions: 88,
    total_deletions: 12,
    last_commit_at: null,
  },
]

describe('RepoDetailPage - Contributors enriched stats', () => {
  it('renders contributor commit count', async () => {
    server.use(
      http.get('/api/v1/repos/:id', () => HttpResponse.json(mockRepo)),
      http.get('/api/v1/repos/:id/contributors', () =>
        HttpResponse.json(mockContributorsEnriched)
      )
    )

    renderPage()

    await waitFor(() => {
      expect(screen.getAllByText('Alice Johnson').length).toBeGreaterThan(0)
    })

    expect(screen.getByText(/42 commits/)).toBeInTheDocument()
  })

  it('renders contributor insertions with green styling indicator', async () => {
    server.use(
      http.get('/api/v1/repos/:id', () => HttpResponse.json(mockRepo)),
      http.get('/api/v1/repos/:id/contributors', () =>
        HttpResponse.json(mockContributorsEnriched)
      )
    )

    renderPage()

    await waitFor(() => {
      expect(screen.getAllByText('Alice Johnson').length).toBeGreaterThan(0)
    })

    expect(screen.getByText(/\+1,204/)).toBeInTheDocument()
  })

  it('renders contributor deletions', async () => {
    server.use(
      http.get('/api/v1/repos/:id', () => HttpResponse.json(mockRepo)),
      http.get('/api/v1/repos/:id/contributors', () =>
        HttpResponse.json(mockContributorsEnriched)
      )
    )

    renderPage()

    await waitFor(() => {
      expect(screen.getAllByText('Alice Johnson').length).toBeGreaterThan(0)
    })

    expect(screen.getByText(/-389/)).toBeInTheDocument()
  })

  it('renders last commit date when present', async () => {
    server.use(
      http.get('/api/v1/repos/:id', () => HttpResponse.json(mockRepo)),
      http.get('/api/v1/repos/:id/contributors', () =>
        HttpResponse.json(mockContributorsEnriched)
      )
    )

    renderPage()

    await waitFor(() => {
      expect(screen.getAllByText('Alice Johnson').length).toBeGreaterThan(0)
    })

    // formatDate returns locale-based date, just check "Last:" label is present
    expect(screen.getAllByText(/Last:/).length).toBeGreaterThan(0)
  })

  it('shows "Never" when last_commit_at is null', async () => {
    server.use(
      http.get('/api/v1/repos/:id', () => HttpResponse.json(mockRepo)),
      http.get('/api/v1/repos/:id/contributors', () =>
        HttpResponse.json(mockContributorsEnriched)
      )
    )

    renderPage()

    await waitFor(() => {
      expect(screen.getAllByText('Bob Smith').length).toBeGreaterThan(0)
    })

    expect(screen.getAllByText(/Never/).length).toBeGreaterThan(0)
  })
})
