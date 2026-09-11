import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { RepoDetailPage } from '@/pages/RepoDetailPage'
import type {
  ClassifyCommitsResponse,
  Commit,
  PaginatedResponse,
  Repo,
} from '@/types'

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

const substantive = commit({
  hash: 'aaa0000000001',
  message: 'feat: add refresh tokens',
  commit_type: 'substantive',
  quality_score: 'good',
})
const logistical = commit({
  hash: 'bbb0000000002',
  message: 'docs: tidy the readme',
  commit_type: 'logistical',
  quality_score: 'bad',
})
const unclassified = commit({
  hash: 'ccc0000000003',
  message: 'wip changes',
})

const ALL_COMMITS = [substantive, logistical, unclassified]

/** Records every classify POST body so the confirm flow can be asserted. */
let classifyCalls: Array<{ confirm: boolean }> = []

function setupHandlers(
  commits: Commit[] = ALL_COMMITS,
  classifyResponse?: Partial<ClassifyCommitsResponse>
) {
  const commitResponse: PaginatedResponse<Commit> = {
    items: commits,
    total: commits.length,
    limit: 500,
    offset: 0,
  }
  const response: ClassifyCommitsResponse = {
    status: 'completed',
    total_commits: 3,
    already_classified: 0,
    pending: 3,
    resolvable_by_rules: 1,
    needs_llm: 2,
    classified_by_rules: 1,
    classified_by_llm: 2,
    classified: 3,
    skipped: 0,
    remaining: 0,
    threshold: 200,
    model_used: 'claude-sonnet-5',
    ...classifyResponse,
  }
  server.use(
    http.get('/api/v1/repos/:id', () => HttpResponse.json(mockRepo)),
    http.get('/api/v1/repos/:id/commits', () => HttpResponse.json(commitResponse)),
    http.get('/api/v1/repos/:id/contributors', () => HttpResponse.json([])),
    http.get('/api/v1/repos/:id/summaries', () => HttpResponse.json([])),
    http.get('/api/v1/notes', () =>
      HttpResponse.json({ items: [], total: 0, limit: 50, offset: 0 })
    ),
    http.post('/api/v1/repos/:id/commits/classify', async ({ request }) => {
      classifyCalls.push((await request.json()) as { confirm: boolean })
      return HttpResponse.json(response)
    })
  )
}

function rowFor(message: string) {
  const cell = screen.getByText(message)
  const row = cell.closest('tr')
  if (!row) throw new Error(`no row for ${message}`)
  return within(row)
}

beforeEach(() => {
  classifyCalls = []
})

describe('RepoDetailPage — commit type and score columns', () => {
  it('renders Type and Score column headers', async () => {
    setupHandlers()
    renderPage()
    await waitFor(() =>
      expect(screen.getByText('feat: add refresh tokens')).toBeInTheDocument()
    )
    expect(screen.getByRole('columnheader', { name: 'Type' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Score' })).toBeInTheDocument()
  })

  it('shows the classification on each commit row', async () => {
    setupHandlers()
    renderPage()
    await waitFor(() =>
      expect(screen.getByText('feat: add refresh tokens')).toBeInTheDocument()
    )
    expect(rowFor('feat: add refresh tokens').getByText('Substantive')).toBeInTheDocument()
    expect(rowFor('feat: add refresh tokens').getByText('Good')).toBeInTheDocument()
    expect(rowFor('docs: tidy the readme').getByText('Logistical')).toBeInTheDocument()
    expect(rowFor('docs: tidy the readme').getByText('Bad')).toBeInTheDocument()
  })

  it('shows a dash for an unclassified commit rather than a default verdict', async () => {
    setupHandlers()
    renderPage()
    await waitFor(() => expect(screen.getByText('wip changes')).toBeInTheDocument())
    const row = rowFor('wip changes')
    // Both Type and Score are unknown, so both cells read as a dash.
    expect(row.getAllByText('—')).toHaveLength(2)
    expect(row.queryByText('Logistical')).not.toBeInTheDocument()
    expect(row.queryByText('OK')).not.toBeInTheDocument()
  })
})

describe('RepoDetailPage — Classify commits action', () => {
  it('posts an unconfirmed classify request when clicked', async () => {
    setupHandlers()
    renderPage()
    await waitFor(() => expect(screen.getByText('wip changes')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /classify commits/i }))

    await waitFor(() => expect(classifyCalls).toHaveLength(1))
    expect(classifyCalls[0]).toEqual({ confirm: false })
  })

  it('asks for confirmation when the backend previews instead of working', async () => {
    setupHandlers(ALL_COMMITS, {
      status: 'preview',
      needs_llm: 412,
      resolvable_by_rules: 88,
      pending: 500,
      classified: 0,
      classified_by_rules: 0,
      classified_by_llm: 0,
      remaining: 500,
    })
    renderPage()
    await waitFor(() => expect(screen.getByText('wip changes')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /classify commits/i }))

    // The dialog must quote the number that actually costs time — the
    // LLM-bound count, not the pending count.
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/412/)).toBeInTheDocument()
  })

  it('re-sends with confirm once the user accepts', async () => {
    setupHandlers(ALL_COMMITS, {
      status: 'preview',
      needs_llm: 412,
      pending: 500,
      classified: 0,
      remaining: 500,
    })
    renderPage()
    await waitFor(() => expect(screen.getByText('wip changes')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /classify commits/i }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: /classify all/i }))

    await waitFor(() => expect(classifyCalls).toHaveLength(2))
    expect(classifyCalls[1]).toEqual({ confirm: true })
  })

  it('does not ask for confirmation when the work is small', async () => {
    setupHandlers()
    renderPage()
    await waitFor(() => expect(screen.getByText('wip changes')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /classify commits/i }))

    await waitFor(() => expect(classifyCalls).toHaveLength(1))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
