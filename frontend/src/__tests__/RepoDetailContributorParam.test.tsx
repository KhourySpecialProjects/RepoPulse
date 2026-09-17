import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
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

// DashboardSearch links with the contributor's full uuid, so that is what
// arrives here. The page's own writes shorten it; an inbound link is left
// exactly as it came.
const ALICE_ID = '550e8400-e29b-41d4-a716-446655440000'
const ALICE_SHORT = '550e8400'

const alice = contributor(ALICE_ID, 'Alice Nguyen', 'alice@example.com')
const bob = contributor('6ba7b810-9dad-11d1-80b4-00c04fd430c8', 'Bob Ray', 'bob@example.com')
// A third, so selecting two people is not the whole roster — that collapses
// to `?contributor=all` and would not exercise the shortening.
const chen = contributor('3f2504e0-4f89-11d3-9a0c-0305e82c3301', 'Chen Wei', 'chen@example.com')

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
    http.get('/api/v1/repos/:id/contributors', () => HttpResponse.json([alice, bob, chen])),
    http.get('/api/v1/repos/:id/summaries', () => HttpResponse.json([])),
    http.get('/api/v1/notes', () =>
      HttpResponse.json({ items: [], total: 0, limit: 50, offset: 0 })
    )
  )
}

/** MemoryRouter never touches window.location, so the URL is read from here. */
function LocationProbe() {
  const { search } = useLocation()
  return <span data-testid="search">{search}</span>
}

function currentSearch(): string {
  return screen.getByTestId('search').textContent ?? ''
}

function renderAt(entry: string) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[entry]}>
        <LocationProbe />
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
    renderAt(`/repos/repo-1?contributor=${ALICE_ID}`)

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

  // The param used to be consumed and deleted on arrival, which meant a
  // reload — or passing the link on — silently dropped the filter. It is now
  // the filter itself, so it stays.
  it('keeps the param so the filtered view survives a reload', async () => {
    setupHandlers()
    renderAt(`/repos/repo-1?contributor=${ALICE_ID}`)

    await screen.findByText(/work by Alice Nguyen/)
    await waitFor(() => expect(currentSearch()).toBe(`?contributor=${ALICE_ID}`))
  })

  it('shortens the id once the reader touches the filter', async () => {
    setupHandlers()
    renderAt(`/repos/repo-1?contributor=${ALICE_ID}`)

    await screen.findByText(/work by Alice Nguyen/)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Bob Ray' }))

    await waitFor(() => expect(currentSearch()).toContain(ALICE_SHORT))
    expect(currentSearch()).not.toContain(ALICE_ID)
  })

  it('drops the param when the contributor is unchecked again', async () => {
    setupHandlers()
    renderAt(`/repos/repo-1?contributor=${ALICE_ID}`)

    await screen.findByText(/work by Alice Nguyen/)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Alice Nguyen' }))

    await waitFor(() => expect(currentSearch()).not.toContain('contributor'))
    expect(await screen.findByText(/work by Bob Ray/)).toBeInTheDocument()
  })
})
