import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { DashboardPage } from '@/pages/DashboardPage'
import type { Collection, Notification, Repo } from '@/types'

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'user-instructor-1', display_name: 'Mark', role: 'instructor' as const },
    isAuthenticated: true,
    isLoading: false,
    login: () => Promise.resolve(),
    devLogin: () => Promise.resolve(),
    logout: () => {},
  }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}))

const collection: Collection = {
  id: 'col-1',
  name: 'Spring 2026 DB Projects',
  course_tag: 'CS 3200',
  semester_tag: 'Spring 2026',
  local_folder_name: 'db-projects',
  owner_id: 'user-instructor-1',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  repo_count: 3,
  is_archived: false,
  health_green: 1,
  health_yellow: 1,
  health_red: 1,
  health_unknown: 0,
}

function makeRepo(over: Partial<Repo> & Pick<Repo, 'id' | 'name'>): Repo {
  return {
    collection_id: 'col-1',
    github_url: `https://github.com/example/${over.name}`,
    local_path: null,
    health_status: 'green',
    health_score: null,
    last_synced_at: '2026-09-14T00:00:00Z',
    last_commit_at: '2026-09-12T00:00:00Z',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    contributor_count: 2,
    active_reminder_count: 0,
    expected_contributor_count: null,
    sync_status: 'idle',
    sync_started_at: null,
    sync_started_by_name: null,
    sync_error: null,
    ...over,
  }
}

const repos: Repo[] = [
  makeRepo({ id: 'repo-green', name: 'db-project-teamA', health_status: 'green' }),
  makeRepo({ id: 'repo-yellow', name: 'db-project-teamD', health_status: 'yellow' }),
  makeRepo({
    id: 'repo-red',
    name: 'db-project-teamG',
    health_status: 'red',
    active_reminder_count: 2,
  }),
]

function makeNotification(over: Partial<Notification> & Pick<Notification, 'id'>): Notification {
  return {
    type: 'mention',
    note_id: null,
    comment_id: null,
    is_read: false,
    created_at: new Date(Date.now() - 45 * 60_000).toISOString(),
    note_content_preview: null,
    repo_id: null,
    commit_hash: null,
    subject: null,
    body: null,
    emailed_at: null,
    ...over,
  }
}

const unreadMention = makeNotification({
  id: 'n-mention',
  type: 'mention',
  note_id: 'note-1',
  repo_id: 'repo-red',
  note_content_preview: 'Hey @Mark take a look at this commit',
})

const unreadPr = makeNotification({
  id: 'n-pr',
  type: 'pr_opened',
  repo_id: 'repo-yellow',
  subject: 'db-project-teamD opened a pull request',
  body: 'Add seed script',
})

const readComment = makeNotification({
  id: 'n-read',
  type: 'note_comment',
  is_read: true,
  repo_id: 'repo-green',
  note_id: 'note-9',
  note_content_preview: 'Already-read reply nobody needs to see',
})

/** Records the query strings the page asked the notifications endpoint for. */
let notificationRequests: string[] = []

function setup(opts?: { notifications?: Notification[]; onPatchRead?: (id: string) => void }) {
  // The feed endpoint honours `unread_only`, so the mock does too — otherwise a
  // panel that forgot to pass the flag would still look correct here.
  const all = opts?.notifications ?? [unreadMention, unreadPr, readComment]
  server.use(
    http.get('/api/v1/collections', () =>
      HttpResponse.json({ items: [collection], total: 1, limit: 50, offset: 0 })
    ),
    http.get('/api/v1/collections/:id/repos', () =>
      HttpResponse.json({ items: repos, total: repos.length, limit: 50, offset: 0 })
    ),
    http.get('/api/v1/notifications', ({ request }) => {
      const url = new URL(request.url)
      notificationRequests.push(url.search)
      const items =
        url.searchParams.get('unread_only') === 'true' ? all.filter((n) => !n.is_read) : all
      return HttpResponse.json({
        items,
        total: items.length,
        unread_count: all.filter((n) => !n.is_read).length,
      })
    }),
    http.get('/api/v1/notifications/unread-count', () =>
      HttpResponse.json({ unread_count: all.filter((n) => !n.is_read).length })
    ),
    http.patch('/api/v1/notifications/:id/read', ({ params }) => {
      opts?.onPatchRead?.(String(params.id))
      return HttpResponse.json({ ...unreadMention, id: String(params.id), is_read: true })
    })
  )
}

function LocationDisplay() {
  const location = useLocation()
  return <span data-testid="location">{location.pathname + location.search}</span>
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/repos/:id" element={<div>Repo page</div>} />
          <Route path="/notifications" element={<div>Notifications page</div>} />
        </Routes>
        <LocationDisplay />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

/** Waits until the repo-backed panels have data, so absence checks are real. */
async function waitForLoaded() {
  await waitFor(() =>
    expect(screen.getAllByRole('link', { name: /db-project-teamG/ }).length).toBeGreaterThan(0)
  )
}

beforeEach(() => {
  notificationRequests = []
  localStorage.clear()
})

// ──────────────────────────────────────────────
// What the dashboard no longer shows
// ──────────────────────────────────────────────
describe('trimmed dashboard', () => {
  it('drops the total-repositories metric card', async () => {
    setup()
    renderPage()
    await waitForLoaded()

    const metrics = screen.getByRole('region', { name: 'Workspace metrics' })
    expect(metrics).not.toHaveTextContent('Repositories')
    expect(metrics).not.toHaveTextContent('active collections')
  })

  it('drops the active-reminders metric card', async () => {
    setup()
    renderPage()
    await waitForLoaded()

    const metrics = screen.getByRole('region', { name: 'Workspace metrics' })
    expect(metrics).not.toHaveTextContent(/active reminders/i)
    expect(metrics).not.toHaveTextContent(/Across \d+ repositories/)
  })

  it('keeps only the two health metrics', async () => {
    setup()
    renderPage()
    await waitForLoaded()

    const metrics = screen.getByRole('region', { name: 'Workspace metrics' })
    expect(metrics).toHaveTextContent('Healthy repositories')
    expect(metrics).toHaveTextContent('Need attention')
  })

  it('drops the "View collections" button from the header', async () => {
    setup()
    renderPage()
    await waitForLoaded()

    expect(screen.queryByRole('link', { name: /view collections/i })).not.toBeInTheDocument()
  })

  it('drops the recently-active repositories table', async () => {
    setup()
    renderPage()
    await waitForLoaded()

    expect(screen.queryByText(/recently active repositories/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('drops the "Your collections" card grid', async () => {
    setup()
    renderPage()
    await waitForLoaded()

    expect(screen.queryByText(/your collections/i)).not.toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: /Spring 2026 DB Projects/ })
    ).not.toBeInTheDocument()
  })

  it('still shows the repositories that need attention', async () => {
    setup()
    renderPage()
    await waitForLoaded()

    expect(screen.getByText('Needs your attention')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /db-project-teamD/ })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /db-project-teamA/ })).not.toBeInTheDocument()
  })
})

// ──────────────────────────────────────────────
// Follow-ups becomes a working notifications feed
// ──────────────────────────────────────────────
describe('recent notifications panel', () => {
  it('replaces "Follow-ups" with "Recent notifications"', async () => {
    setup()
    renderPage()

    await waitFor(() => expect(screen.getByText('Recent notifications')).toBeInTheDocument())
    expect(screen.queryByText(/follow-ups/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/repositories with active reminders/i)).not.toBeInTheDocument()
  })

  it('asks the API for unread notifications only', async () => {
    setup()
    renderPage()

    await waitFor(() => expect(notificationRequests.length).toBeGreaterThan(0))
    expect(notificationRequests.every((search) => search.includes('unread_only=true'))).toBe(true)
  })

  it('renders each unread notification', async () => {
    setup()
    renderPage()

    await waitFor(() => expect(screen.getAllByTestId('dashboard-notification')).toHaveLength(2))
    expect(screen.getByText('Hey @Mark take a look at this commit')).toBeInTheDocument()
    expect(screen.getByText('db-project-teamD opened a pull request')).toBeInTheDocument()
  })

  it('titles note-scoped notifications by their event type', async () => {
    setup()
    renderPage()

    await waitFor(() => expect(screen.getByText('You were mentioned')).toBeInTheDocument())
  })

  it('does not show notifications that are already read', async () => {
    setup()
    renderPage()

    await waitFor(() => expect(screen.getAllByTestId('dashboard-notification')).toHaveLength(2))
    expect(screen.queryByText(/already-read reply/i)).not.toBeInTheDocument()
  })

  it('shows how many are unread', async () => {
    setup()
    renderPage()

    const panel = await waitFor(() =>
      screen.getByRole('region', { name: 'Recent notifications' })
    )
    await waitFor(() => expect(panel).toHaveTextContent('2'))
  })

  it('marks a notification read and deep-links to what it was about', async () => {
    const read: string[] = []
    setup({ onPatchRead: (id) => read.push(id) })
    renderPage()

    const row = await waitFor(() => screen.getByRole('button', { name: /You were mentioned/ }))
    fireEvent.click(row)

    await waitFor(() => expect(read).toEqual(['n-mention']))
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('/repos/repo-red?note=note-1')
    )
  })

  it('shows an empty state when nothing is unread', async () => {
    setup({ notifications: [readComment] })
    renderPage()

    await waitFor(() =>
      expect(screen.getByText(/no unread notifications/i)).toBeInTheDocument()
    )
    expect(screen.queryAllByTestId('dashboard-notification')).toHaveLength(0)
  })

  it('links through to the full notifications page', async () => {
    setup()
    renderPage()

    const link = await waitFor(() => screen.getByRole('link', { name: /view all/i }))
    expect(link).toHaveAttribute('href', '/notifications')
  })
})
