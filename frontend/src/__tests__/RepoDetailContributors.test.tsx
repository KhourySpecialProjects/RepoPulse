import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
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

beforeEach(() => {
  localStorage.removeItem('repo-pull-requests-expanded-repo-1')
  localStorage.removeItem('repo-pull-requests-expanded-repo-2')
  // Exercise the stored-stat fallback without unrelated global mock commits.
  server.use(
    http.get('/api/v1/repos/:id/commits', () => HttpResponse.json({ items: [], total: 0, limit: 50, offset: 0 })),
  )
})

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
  last_commit_at: null,
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


it('uses contributor checkboxes for the graph and offers explicit merge', async () => {
  server.use(
    http.get('/api/v1/repos/:id', () => HttpResponse.json(mockRepo)),
    http.get('/api/v1/repos/:id/contributors', () => HttpResponse.json(mockContributorsEnriched)),
    http.get('/api/v1/collections/:id/contextual-activity', () => HttpResponse.json({ repositories: [{
      id: 'repo-1', name: 'Test', available: true, activity: [{ date: '2026-09-01', count: 3 }],
      students: mockContributorsEnriched.map(c => ({ id: c.id, name: c.display_name, activity: [{ date: '2026-09-01', count: 1 }] })),
    }] })),
  )
  renderPage()
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Select Alice Johnson' }))
  expect(await screen.findByText('Alice Johnson — commits per day')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Merge' })).not.toBeInTheDocument()
  expect(screen.queryByText('Author:')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select Bob Smith' }))
  expect(screen.getByText('All students — commits per day')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Confirm Merge' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Merge' }))
  expect(screen.getByRole('button', { name: 'Confirm Merge' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(screen.getByRole('checkbox', { name: 'Select Alice Johnson' })).toBeChecked()
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select all contributors' }))
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select all contributors' }))
  expect(screen.getByRole('checkbox', { name: 'Select Bob Smith' })).toBeChecked()
})

it('unmerges the selected group one step at a time and refreshes contributors', async () => {
  let step = 0
  const unmerge = vi.fn()
  const groups = () => step === 0
    ? [{ ...mockContributorsEnriched[0], display_name: 'ABC', can_unmerge: true }]
    : step === 1
      ? [{ ...mockContributorsEnriched[0], display_name: 'AB', can_unmerge: true }, mockContributorsEnriched[1]]
      : mockContributorsEnriched
  server.use(
    http.get('/api/v1/repos/:id', () => HttpResponse.json(mockRepo)),
    http.get('/api/v1/repos/:id/contributors', () => HttpResponse.json(groups())),
    http.post('/api/v1/contributors/:id/unmerge', ({ params }) => {
      unmerge(params.id)
      step++
      return HttpResponse.json({ contributors: groups() })
    }),
  )
  renderPage()
  expect(screen.queryByRole('button', { name: 'Unmerge' })).not.toBeInTheDocument()
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Select ABC' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Unmerge' }))
  expect(await screen.findByRole('checkbox', { name: 'Select AB' })).toBeChecked()
  fireEvent.click(await screen.findByRole('button', { name: 'Unmerge' }))
  expect(await screen.findByRole('checkbox', { name: 'Select Alice Johnson' })).toBeChecked()
  expect(screen.queryByRole('button', { name: 'Unmerge' })).not.toBeInTheDocument()
  expect(unmerge).toHaveBeenNthCalledWith(1, 'contrib-1')
  expect(unmerge).toHaveBeenNthCalledWith(2, 'contrib-1')
})

it('only offers unmerge for one eligible selection and keeps it selected on failure', async () => {
  const unmerge = vi.fn()
  server.use(
    http.get('/api/v1/repos/:id', () => HttpResponse.json(mockRepo)),
    http.get('/api/v1/repos/:id/contributors', () => HttpResponse.json([
      { ...mockContributorsEnriched[0], can_unmerge: true }, mockContributorsEnriched[1],
    ])),
    http.post('/api/v1/contributors/:id/unmerge', () => {
      unmerge()
      return HttpResponse.json({ detail: 'No saved merge', error_code: 'NO_MERGE_HISTORY' }, { status: 409 })
    }),
  )
  renderPage()
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Select Alice Johnson' }))
  expect(screen.getByRole('button', { name: 'Unmerge' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select Bob Smith' }))
  expect(screen.queryByRole('button', { name: 'Unmerge' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select Bob Smith' }))
  fireEvent.click(screen.getByRole('button', { name: 'Unmerge' }))
  await waitFor(() => expect(unmerge).toHaveBeenCalledTimes(1))
  expect(await screen.findByRole('button', { name: 'Unmerge' })).toBeEnabled()
  expect(screen.getByRole('checkbox', { name: 'Select Alice Johnson' })).toBeChecked()
})


it('filters commits by selected contributors and aliases, combines branches, and resets pagination', async () => {
  const people = [
    { ...mockContributorsEnriched[0], aliases: [
      { id: 'a1', git_email: 'ALICE@example.com', git_name: 'Alice' },
      { id: 'a2', git_email: 'alias@example.com', git_name: 'Alias' },
    ] },
    { ...mockContributorsEnriched[1], aliases: [{ id: 'b1', git_email: 'bob@example.com', git_name: 'Bob' }] },
  ]
  const commits = Array.from({ length: 12 }, (_, i) => ({
    hash: `commit-${i}`, message: `Change number ${i}`, author_name: 'Student',
    author_email: i === 0 ? 'alice@example.com' : i === 1 ? 'alias@example.com' : 'bob@example.com',
    date: '2026-09-01T12:00:00Z', branches: [i === 1 ? 'feature' : 'main'],
    insertions: 1, deletions: 0, files_changed: 1,
  }))
  server.use(
    http.get('/api/v1/repos/:id', () => HttpResponse.json(mockRepo)),
    http.get('/api/v1/repos/:id/contributors', () => HttpResponse.json(people)),
    http.get('/api/v1/repos/:id/commits', () => HttpResponse.json({ items: commits, total: 12, limit: 500, offset: 0 })),
  )
  renderPage()
  await screen.findByRole('checkbox', { name: 'Select Alice Johnson' })
  fireEvent.click(screen.getAllByRole('button', { name: 'Next' })[0])
  expect(within(screen.getByRole('region', { name: 'Commit list' })).getByText('Change number 11')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select Alice Johnson' }))
  await waitFor(() => {
    const list = within(screen.getByRole('region', { name: 'Commit list' }))
    expect(list.getByText('Change number 0')).toBeInTheDocument()
    expect(list.getByText('Change number 1')).toBeInTheDocument()
    expect(list.queryByText('Change number 2')).not.toBeInTheDocument()
    expect(list.queryByText('Change number 11')).not.toBeInTheDocument()
  })
  fireEvent.click(screen.getAllByRole('button', { name: 'main' })[0])
  expect(within(screen.getByRole('region', { name: 'Commit list' })).queryByText('Change number 1')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select Bob Smith' }))
  expect(within(screen.getByRole('region', { name: 'Commit list' })).getByText('Change number 2')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select all contributors' }))
  expect(within(screen.getByRole('region', { name: 'Commit list' })).getByText('Change number 0')).toBeInTheDocument()
})

it('places Pull Requests above a sticky, scrollable Contributors panel', async () => {
  server.use(
    http.get('/api/v1/repos/:id', () => HttpResponse.json(mockRepo)),
    http.get('/api/v1/repos/:id/contributors', () => HttpResponse.json(mockContributorsEnriched)),
  )
  renderPage()
  const contributorsHeading = await screen.findByRole('heading', { name: 'Contributors' })
  const pullRequestsHeading = screen.getByRole('heading', { name: 'Pull Requests' })
  expect(pullRequestsHeading.compareDocumentPosition(contributorsHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  const panel = contributorsHeading.parentElement!.parentElement!
  expect(panel).toHaveClass('sticky', 'top-6', 'overflow-y-auto', 'max-h-[calc(100vh-3rem)]')
  expect(panel.parentElement).toHaveClass('self-stretch')
})

it('collapses Pull Requests to its header without hiding contributors', async () => {
  server.use(
    http.get('/api/v1/repos/:id', () => HttpResponse.json(mockRepo)),
    http.get('/api/v1/repos/:id/contributors', () => HttpResponse.json(mockContributorsEnriched)),
  )
  renderPage()
  const toggle = await screen.findByRole('button', { name: 'Pull Requests' })
  expect(toggle).toHaveAttribute('aria-expanded', 'true')
  const content = document.getElementById(toggle.getAttribute('aria-controls')!)!
  expect(content).toBeVisible()
  fireEvent.click(toggle)
  expect(toggle).toHaveAttribute('aria-expanded', 'false')
  expect(content).not.toBeVisible()
  expect(screen.getByRole('heading', { name: 'Pull Requests' })).toBeVisible()
  expect(screen.getByRole('checkbox', { name: 'Select Alice Johnson' })).toBeVisible()
  fireEvent.click(toggle)
  expect(content).toBeVisible()
})


it('remembers collapsed and expanded Pull Requests separately for each repository', async () => {
  server.use(
    http.get('/api/v1/repos/:id', ({ params }) => HttpResponse.json({ ...mockRepo, id: params.id })),
    http.get('/api/v1/repos/:id/contributors', () => HttpResponse.json(mockContributorsEnriched)),
  )
  let page = renderPage()
  fireEvent.click(await screen.findByRole('button', { name: 'Pull Requests' }))
  page.unmount()
  page = renderPage()
  expect(await screen.findByRole('button', { name: 'Pull Requests' })).toHaveAttribute('aria-expanded', 'false')
  page.unmount()
  page = renderPage('repo-2')
  expect(await screen.findByRole('button', { name: 'Pull Requests' })).toHaveAttribute('aria-expanded', 'true')
  page.unmount()
  page = renderPage()
  fireEvent.click(await screen.findByRole('button', { name: 'Pull Requests' }))
  page.unmount()
  renderPage()
  expect(await screen.findByRole('button', { name: 'Pull Requests' })).toHaveAttribute('aria-expanded', 'true')
})
