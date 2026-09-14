import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react'
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
  last_commit_at: '2025-10-14T14:00:00Z',
  created_at: '2025-09-01T00:00:00Z',
  updated_at: '2025-10-15T10:00:00Z',
  contributor_count: 2,
  active_reminder_count: 0,
  expected_contributor_count: null,
}

function commit(overrides: Partial<Commit> & Pick<Commit, 'hash' | 'message'>): Commit {
  return {
    author_name: 'Alice Johnson',
    author_email: 'alice@example.com',
    date: '2025-10-14T14:00:00Z',
    branches: ['main'],
    insertions: 10,
    deletions: 2,
    files_changed: 1,
    commit_type: null,
    quality_score: null,
    ...overrides,
  }
}

const COMMITS = [
  commit({ hash: 'a'.repeat(13), message: 'feat: real work', commit_type: 'substantive' }),
  commit({ hash: 'b'.repeat(13), message: 'docs: housekeeping', commit_type: 'logistical' }),
  commit({ hash: 'c'.repeat(13), message: 'wip untriaged' }),
]

function setupHandlers() {
  const commitResponse: PaginatedResponse<Commit> = {
    items: COMMITS,
    total: COMMITS.length,
    limit: 500,
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

/** Scope to the Type row. "All" is not unique — Branch and Author have one
 *  each, and the chart range selector adds another. */
function typeFilter() {
  return within(screen.getByRole('group', { name: /commit type/i }))
}

async function renderAndWait() {
  setupHandlers()
  renderPage()
  await waitFor(() => expect(screen.getByText('feat: real work')).toBeInTheDocument())
}

describe('RepoDetailPage — commit type filter', () => {
  it('offers All, both types, and Unclassified', async () => {
    await renderAndWait()
    const row = typeFilter()
    expect(row.getByRole('button', { name: 'All' })).toBeInTheDocument()
    expect(row.getByRole('button', { name: 'Substantive' })).toBeInTheDocument()
    expect(row.getByRole('button', { name: 'Logistical' })).toBeInTheDocument()
    expect(row.getByRole('button', { name: 'Unclassified' })).toBeInTheDocument()
  })

  it('colours each chip to match the row tint it filters for', async () => {
    await renderAndWait()
    const row = typeFilter()
    // The chips are the only legend for the row backgrounds now that the Type
    // column is gone, so a mismatch here is a genuine UI bug, not cosmetics.
    expect(row.getByRole('button', { name: 'Substantive' }).className).toContain(
      'emerald'
    )
    expect(row.getByRole('button', { name: 'Logistical' }).className).toContain(
      'orange'
    )
  })

  it('shows every commit before any filter is applied', async () => {
    await renderAndWait()
    expect(screen.getByText('feat: real work')).toBeInTheDocument()
    expect(screen.getByText('docs: housekeeping')).toBeInTheDocument()
    expect(screen.getByText('wip untriaged')).toBeInTheDocument()
  })

  it('narrows the table to the selected type', async () => {
    await renderAndWait()
    fireEvent.click(typeFilter().getByRole('button', { name: 'Substantive' }))

    await waitFor(() =>
      expect(screen.queryByText('docs: housekeeping')).not.toBeInTheDocument()
    )
    expect(screen.getByText('feat: real work')).toBeInTheDocument()
    expect(screen.queryByText('wip untriaged')).not.toBeInTheDocument()
  })

  it('treats Unclassified as its own bucket', async () => {
    await renderAndWait()
    fireEvent.click(typeFilter().getByRole('button', { name: 'Unclassified' }))

    await waitFor(() =>
      expect(screen.queryByText('feat: real work')).not.toBeInTheDocument()
    )
    expect(screen.getByText('wip untriaged')).toBeInTheDocument()
  })

  it('restores everything when All is clicked', async () => {
    await renderAndWait()
    fireEvent.click(typeFilter().getByRole('button', { name: 'Logistical' }))
    await waitFor(() =>
      expect(screen.queryByText('feat: real work')).not.toBeInTheDocument()
    )

    fireEvent.click(typeFilter().getByRole('button', { name: 'All' }))
    await waitFor(() =>
      expect(screen.getByText('feat: real work')).toBeInTheDocument()
    )
    expect(screen.getByText('wip untriaged')).toBeInTheDocument()
  })

  it('selecting two types shows both', async () => {
    await renderAndWait()
    fireEvent.click(typeFilter().getByRole('button', { name: 'Substantive' }))
    fireEvent.click(typeFilter().getByRole('button', { name: 'Logistical' }))

    await waitFor(() =>
      expect(screen.getByText('docs: housekeeping')).toBeInTheDocument()
    )
    expect(screen.getByText('feat: real work')).toBeInTheDocument()
    expect(screen.queryByText('wip untriaged')).not.toBeInTheDocument()
  })

  it('reports the filtered count against the total', async () => {
    await renderAndWait()
    fireEvent.click(typeFilter().getByRole('button', { name: 'Substantive' }))
    // The counter is rendered above and below the table, and the regex also
    // matches the wrapping <p>, so several nodes legitimately match.
    await waitFor(() =>
      expect(screen.getAllByText(/1 commit/).length).toBeGreaterThan(0)
    )
    expect(screen.getAllByText(/\(of 3\)/).length).toBeGreaterThan(0)
  })
})
