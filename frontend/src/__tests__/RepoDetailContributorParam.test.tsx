import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { RepoDetailPage } from '@/pages/RepoDetailPage'
import type { Commit, Contributor, Repo } from '@/types'

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
  last_synced_at: '2026-09-15T10:00:00Z',
  last_commit_at: '2026-09-14T14:00:00Z',
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-15T10:00:00Z',
  contributor_count: 2,
  active_reminder_count: 0,
  expected_contributor_count: null,
  sync_status: 'idle',
  sync_started_at: null,
  sync_started_by_name: null,
  sync_error: null,
}

function contributor(id: string, name: string, email: string): Contributor {
  return {
    id,
    display_name: name,
    repo_id: 'repo-1',
    created_at: '2026-09-01T00:00:00Z',
    aliases: [{ id: `${id}-a`, git_email: email, git_name: name }],
    commit_count: 1,
    total_insertions: 10,
    total_deletions: 1,
    last_commit_at: '2026-09-14T14:00:00Z',
  }
}

function commit(hash: string, name: string, email: string): Commit {
  return {
    hash,
    author_name: name,
    author_email: email,
    date: '2026-09-14T14:00:00Z',
    message: `work by ${name}`,
    branches: ['main'],
    origin_branch: 'main',
    insertions: 10,
    deletions: 1,
    files_changed: 2,
    commit_type: null,
    quality_score: null,
  }
}

const alice = contributor('c-alice', 'Alice Nguyen', 'alice@example.com')
const bob = contributor('c-bob', 'Bob Ray', 'bob@example.com')

function setupHandlers() {
  server.use(
    http.get('/api/v1/repos/:id', () => HttpResponse.json(mockRepo)),
    http.get('/api/v1/repos/:id/health', () => HttpResponse.json(null)),
    http.get('/api/v1/repos/:id/commits', () =>
      HttpResponse.json({
        items: [
          commit('aaa1111', 'Alice Nguyen', 'alice@example.com'),
          commit('bbb2222', 'Bob Ray', 'bob@example.com'),
        ],
        total: 2,
        limit: 500,
        offset: 0,
      })
    ),
    http.get('/api/v1/repos/:id/contributors', () => HttpResponse.json([alice, bob])),
    http.get('/api/v1/repos/:id/summaries', () => HttpResponse.json([])),
    http.get('/api/v1/notes', () =>
      HttpResponse.json({ items: [], total: 0, limit: 50, offset: 0 })
    )
  )
}

function renderAt(entry: string) {
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
 * Workspace search can find a person, but a person only exists inside a repo.
 * `?contributor=` is how that hit lands somewhere useful instead of on an
 * unexplained repository page.
 */
describe('RepoDetailPage — ?contributor= from workspace search', () => {
  it('filters the commit list to the contributor named in the URL', async () => {
    setupHandlers()
    renderAt('/repos/repo-1?contributor=c-alice')

    expect(await screen.findByText(/work by Alice Nguyen/)).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.queryByText(/work by Bob Ray/)).not.toBeInTheDocument()
    )
  })

  it('shows every contributor when the param is absent', async () => {
    setupHandlers()
    renderAt('/repos/repo-1')

    expect(await screen.findByText(/work by Alice Nguyen/)).toBeInTheDocument()
    expect(screen.getByText(/work by Bob Ray/)).toBeInTheDocument()
  })

  // Left in the URL, a reload would silently re-apply a filter the reader had
  // since cleared.
  it('consumes the param so a reload does not re-apply the filter', async () => {
    setupHandlers()
    renderAt('/repos/repo-1?contributor=c-alice')

    await screen.findByText(/work by Alice Nguyen/)
    await waitFor(() => expect(window.location.search).not.toContain('contributor'))
  })
})
