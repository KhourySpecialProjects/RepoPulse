import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { DashboardPage } from '@/pages/DashboardPage'
import type { Collection, HealthScore, Repo } from '@/types'

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'user-instructor-1', display_name: 'Mark', role: 'admin' as const },
    isAuthenticated: true,
    isLoading: false,
    login: () => Promise.resolve(),
    devLogin: () => Promise.resolve(),
    logout: () => {},
  }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}))

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-15T12:00:00Z'))
})
afterEach(() => vi.useRealTimers())

const score = (over: Partial<HealthScore> = {}): HealthScore => ({
  commit_frequency: 2,
  recency: 2,
  distribution: 0,
  branch_activity: 2,
  commit_message_quality: 2,
  participation: 2,
  composite: 0.7,
  status: 'yellow',
  ...over,
})

const repo = (over: Partial<Repo> = {}): Repo => ({
  id: 'repo-1',
  collection_id: 'col-1',
  github_url: 'https://github.com/student/project',
  name: 'student-project',
  local_path: '/repos/student-project',
  health_status: 'green',
  health_score: score(),
  last_synced_at: '2026-09-15T10:00:00Z',
  last_commit_at: '2026-09-15T08:00:00Z',
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-15T10:00:00Z',
  contributor_count: 4,
  active_reminder_count: 0,
  expected_contributor_count: null,
  sync_status: 'idle',
  sync_started_at: null,
  sync_started_by_name: null,
  sync_error: null,
  ...over,
})

const collection: Collection = {
  id: 'col-1',
  name: 'Fall Capstone',
  course_tag: 'CS4500',
  semester_tag: null,
  local_folder_name: 'fall-capstone',
  owner_id: 'user-instructor-1',
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
  repo_count: 2,
  is_archived: false,
  health_green: 1,
  health_yellow: 0,
  health_red: 1,
  health_unknown: 0,
}

/** 12 commits in the last 30 days, 6 in the 30 before that. */
const activity = [
  { date: '2026-09-14', count: 8 },
  { date: '2026-09-10', count: 4 },
  { date: '2026-08-01', count: 6 },
  { date: '2024-01-01', count: 500 },
]

const REMINDERS = [
  {
    id: 'rem-1',
    content: 'Check in with the API team about test coverage',
    remind_at: '2026-09-16T09:00:00Z',
    reminder_context: null,
    repo_id: 'repo-1',
    commit_hash: null,
    created_at: '2026-09-10T00:00:00Z',
    owner_display_name: 'Mark',
    shared_with: [],
    is_owner: true,
  },
  {
    // No repo behind it — the case the old count-based list could never show.
    id: 'rem-2',
    content: 'Draft the midterm rubric',
    remind_at: null,
    reminder_context: null,
    repo_id: null,
    commit_hash: null,
    created_at: '2026-09-11T00:00:00Z',
    owner_display_name: 'Mark',
    shared_with: [],
    is_owner: true,
  },
]

function setup(repos: Repo[], reminders = REMINDERS) {
  server.use(
    http.get('/api/v1/notifications/reminders', () =>
      HttpResponse.json({ items: reminders, total: reminders.length })
    ),
    http.get('/api/v1/collections', () =>
      HttpResponse.json({ items: [collection], total: 1, limit: 50, offset: 0 })
    ),
    http.get('/api/v1/collections/:id/repos', () =>
      HttpResponse.json({ items: repos, total: repos.length, limit: 50, offset: 0 })
    ),
    http.get('/api/v1/collections/:id/commit-activity', () => HttpResponse.json({ activity }))
  )
}

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/']}>
        <DashboardPage />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('DashboardPage — workspace pulse', () => {
  it('totals the commits in the window and compares them to the one before', async () => {
    setup([repo()])
    renderPage()

    const pulse = await screen.findByLabelText('Workspace pulse')
    expect(await within(pulse).findByText('12')).toBeInTheDocument()
    expect(within(pulse).getByText('commits in 30 days')).toBeInTheDocument()
    // 12 against 6 in the previous 30 days.
    expect(within(pulse).getByText('100% up')).toBeInTheDocument()
  })

  it('re-scopes the chart when a different range is picked', async () => {
    setup([repo()])
    renderPage()

    const pulse = await screen.findByLabelText('Workspace pulse')
    await within(pulse).findByText('12')

    await userEvent.click(within(pulse).getByRole('button', { name: '14d' }))

    expect(within(pulse).getByText('commits in 14 days')).toBeInTheDocument()
    // The 2026-08-01 commits fall outside a 14-day window.
    expect(within(pulse).getByText('12')).toBeInTheDocument()
  })

  it('names the peak day rather than leaving the spike unexplained', async () => {
    setup([repo()])
    renderPage()

    const pulse = await screen.findByLabelText('Workspace pulse')
    expect(await within(pulse).findByText(/peak/i)).toHaveTextContent('8')
  })
})

describe('DashboardPage — health charts', () => {
  it('puts the healthy share in the middle of the donut', async () => {
    setup([repo({ id: 'a' }), repo({ id: 'b', health_status: 'red' })])
    renderPage()

    const donut = await screen.findByLabelText('Health mix')
    expect(await within(donut).findByText('50%')).toBeInTheDocument()
    expect(within(donut).getByText('healthy')).toBeInTheDocument()
  })

  it('lists every status in the legend, including the empty ones', async () => {
    setup([repo()])
    renderPage()

    const donut = await screen.findByLabelText('Health mix')
    await within(donut).findByText('Healthy')
    ;['At Risk', 'Critical', 'Unknown'].forEach(label =>
      expect(within(donut).getByText(label)).toBeInTheDocument()
    )
  })

  it('names the weakest signal under the radar', async () => {
    setup([repo()])
    renderPage()

    const radar = await screen.findByLabelText('Health signal averages')
    expect(await within(radar).findByText(/Weakest signal/)).toHaveTextContent('Distribution')
  })

  it('spreads the repositories across last-commit buckets', async () => {
    setup([
      repo({ id: 'a', last_commit_at: '2026-09-15T08:00:00Z' }),
      repo({ id: 'b', last_commit_at: '2026-08-01T08:00:00Z' }),
    ])
    renderPage()

    const recency = await screen.findByLabelText('Commit recency spread')
    await within(recency).findByText('Today')
    expect(within(recency).getByText('15+ days')).toBeInTheDocument()
  })
})

describe('DashboardPage — insights', () => {
  it('turns the numbers into findings, worst first', async () => {
    setup([
      repo({ id: 'a', last_commit_at: '2026-06-01T00:00:00Z' }),
      repo({ id: 'b', contributor_count: 1 }),
    ])
    renderPage()

    const strip = await screen.findByLabelText('Workspace insights')
    const findings = await within(strip).findAllByText(/repositor/)
    expect(findings[0]).toHaveTextContent('no commits in 14 days')
    expect(within(strip).getByText(/single contributor/)).toBeInTheDocument()
  })

  it('says nothing at all rather than padding an empty workspace', async () => {
    setup([])
    renderPage()

    await waitFor(() => expect(screen.getByLabelText('Health mix')).toBeInTheDocument())
    expect(screen.queryByLabelText('Workspace insights')).not.toBeInTheDocument()
  })
})

/**
 * jsdom has no layout, so none of this can measure a pixel. What it can pin is
 * the mechanism that produces centring: two outer tracks of identical width
 * with the search between them. `justify-between` looked centred in review and
 * was not, because the title and the control cluster are different widths.
 */
describe('DashboardPage — toolbar layout', () => {
  it('centres the search on a symmetric three-track grid', async () => {
    setup([repo()])
    renderPage()

    const header = await screen.findByTestId('page-header')
    expect(header.className).toContain('grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]')
    // A leftover justify-between would fight the grid tracks.
    expect(header.className).not.toContain('justify-between')
  })

  it('puts the search between the title and the controls', async () => {
    setup([repo()])
    renderPage()

    const header = await screen.findByTestId('page-header')
    const search = screen.getByRole('combobox', { name: 'Search repositories and people' })
    const [first, middle, last] = Array.from(header.children)

    expect(first).toHaveTextContent('Dashboard')
    expect(middle.contains(search)).toBe(true)
    expect(last).toContainElement(screen.getByLabelText('Collection scope'))
  })
})

describe('DashboardPage — working lists survive', () => {
  it('keeps the attention list and follow-ups', async () => {
    setup([repo({ health_status: 'red', active_reminder_count: 2 })])
    renderPage()

    expect(await screen.findByText('Needs attention')).toBeInTheDocument()
    expect(screen.getByText('Follow-ups')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
  })
})

describe('DashboardPage — interactive workspace', () => {
  it('scopes the metrics, activity and repository map to the selected collection', async () => {
    setup([])
    server.use(
      http.get('/api/v1/collections', () => HttpResponse.json({
        items: [collection, { ...collection, id: 'col-2', name: 'Spring Studio' }], total: 2, limit: 50, offset: 0,
      })),
      http.get('/api/v1/collections/:id/repos', ({ params }) => HttpResponse.json({
        items: [repo({ id: String(params.id), name: params.id === 'col-1' ? 'alpha' : 'beta' })], total: 1, limit: 50, offset: 0,
      })),
      http.get('/api/v1/collections/:id/commit-activity', ({ params }) => HttpResponse.json({
        activity: params.id === 'col-1' ? activity : [{ date: '2026-09-14', count: 3 }],
      }))
    )
    renderPage()
    const pulse = screen.getByLabelText('Workspace pulse')
    await within(pulse).findByText('15')
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Collection scope' }), 'col-2')
    await within(pulse).findByText('3')
    const map = screen.getByRole('navigation', { name: 'Repository health map' })
    expect(within(map).getByRole('link', { name: /beta/ })).toHaveAttribute('href', '/repos/col-2')
    expect(within(map).queryByRole('link', { name: /alpha/ })).not.toBeInTheDocument()
    expect(within(screen.getByLabelText('Workspace metrics')).getByText('repos · 1 collection')).toBeInTheDocument()
  })

  it('uses health legend buttons to explore repositories with that status', async () => {
    setup([repo({ id: 'good', name: 'healthy-team' }), repo({ id: 'bad', name: 'critical-team', health_status: 'red' })])
    renderPage()
    const list = await screen.findByTestId('attention-list')
    await within(list).findByText('critical-team')
    await userEvent.click(screen.getByRole('button', { name: 'Show Healthy repositories' }))
    expect(within(list).getByText('healthy-team')).toBeInTheDocument()
    expect(within(list).queryByText('critical-team')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Clear health filter' }))
    expect(within(list).getByText('critical-team')).toBeInTheDocument()
  })

  it('shows an activity failure instead of a fabricated zero and can retry', async () => {
    setup([repo()])
    server.use(http.get('/api/v1/collections/:id/commit-activity', () => new HttpResponse(null, { status: 503 })))
    renderPage()
    const pulse = screen.getByLabelText('Workspace pulse')
    await within(pulse).findByText('Commit activity is unavailable.')
    expect(within(pulse).queryByText('no prior commits')).not.toBeInTheDocument()
    server.use(http.get('/api/v1/collections/:id/commit-activity', () => HttpResponse.json({ activity })))
    await userEvent.click(within(pulse).getByRole('button', { name: 'Retry activity' }))
    await within(pulse).findByText('12')
  })

  it('offers an actionable starting point when there are no collections', async () => {
    setup([])
    server.use(http.get('/api/v1/collections', () => HttpResponse.json({ items: [], total: 0, limit: 50, offset: 0 })))
    renderPage()
    expect(await screen.findByRole('link', { name: 'Create your first collection' })).toHaveAttribute('href', '/collections')
  })

  it('identifies an empty activity series without suggesting a positive trend', async () => {
    setup([repo()])
    server.use(http.get('/api/v1/collections/:id/commit-activity', () => HttpResponse.json({ activity: [] })))
    renderPage()
    const pulse = screen.getByLabelText('Workspace pulse')
    expect(await within(pulse).findByText('No commit activity available')).toBeInTheDocument()
    expect(within(pulse).queryByText(/% up/)).not.toBeInTheDocument()
  })
})

/**
 * The dashboard is meant to be read at a glance, in one screen. Nothing here
 * can prove a pixel height in jsdom, so these guard the two things that made it
 * scroll: lists that grow with the data, and sections that only restate what a
 * chart above them already says.
 */
describe('DashboardPage — stays within one screen', () => {
  it('caps the page at the viewport instead of letting content set its height', async () => {
    setup([repo()])
    const { container } = renderPage()

    await screen.findByLabelText('Workspace pulse')
    const root = container.firstElementChild as HTMLElement
    expect(root.className).toContain('h-screen')
    expect(root.className).toContain('overflow-hidden')
  })

  it('scrolls the lists inside their own cards rather than growing the page', async () => {
    setup(Array.from({ length: 40 }, (_, i) => repo({ id: `r${i}`, health_status: 'red' })))
    renderPage()

    const list = await screen.findByTestId('attention-list')
    expect(list.className).toMatch(/overflow-(y-)?auto/)
    // Bounded by its flex parent rather than a hardcoded max-height, so the
    // list grows with the window. min-h-0 is what stops flex-1 from being
    // overridden by the content's intrinsic height.
    expect(list.className).toContain('min-h-0')
    expect(list.className).toContain('flex-1')
  })

  it('drops the sections that only repeat a chart', async () => {
    setup([repo()])
    renderPage()

    await screen.findByLabelText('Workspace pulse')
    // Last-commit dates are already the "Last commit" chart, and the
    // collection grid is already the sidebar plus the header button.
    expect(screen.queryByText('Recently active repositories')).not.toBeInTheDocument()
    expect(screen.queryByText('Your collections')).not.toBeInTheDocument()
  })

  it('carries no decorative prose', async () => {
    setup([repo()])
    renderPage()

    await screen.findByLabelText('Workspace pulse')
    ;[
      'Workspace overview',
      /Active collections only/,
      /Review these repositories first/,
      /Where every repository stands today/,
      /How recently each repository was touched/,
      /Ordered by latest indexed commit/,
    ].forEach(text => expect(screen.queryByText(text)).not.toBeInTheDocument())
  })
})


/**
 * Follow-ups used to be derived from `repo.active_reminder_count`, which counts
 * only repo-attached reminders and ignores who they belong to. A standalone
 * reminder could never appear, and the card listed repo names with a tally
 * rather than the reminders themselves. It now reads /reminders, the same
 * source the notifications panel uses.
 */
describe('DashboardPage — follow-ups', () => {
  it('lists the actual reminders, not a per-repo tally', async () => {
    setup([repo()])
    renderPage()

    const followups = await screen.findByTestId('followup-list')
    expect(
      await within(followups).findByText(/Check in with the API team/)
    ).toBeInTheDocument()
  })

  it('shows a reminder that is not attached to any repository', async () => {
    setup([repo()])
    renderPage()

    const followups = await screen.findByTestId('followup-list')
    expect(await within(followups).findByText(/Draft the midterm rubric/)).toBeInTheDocument()
  })

  it('counts every reminder in the metric tile, repo-attached or not', async () => {
    setup([repo()])
    renderPage()

    const metrics = await screen.findByLabelText('Workspace metrics')
    const tile = within(metrics).getByText('active reminders').closest('div')
      ?.parentElement as HTMLElement
    expect(await within(tile).findByText('2')).toBeInTheDocument()
  })

  it('opens the repository behind a reminder, on that note', async () => {
    setup([repo()])
    renderPage()

    const followups = await screen.findByTestId('followup-list')
    const link = await within(followups).findByRole('link', {
      name: /Check in with the API team/,
    })
    expect(link).toHaveAttribute('href', '/repos/repo-1?note=rem-1')
  })

  it('sends a repo-less reminder to the notifications page instead', async () => {
    setup([repo()])
    renderPage()

    const followups = await screen.findByTestId('followup-list')
    const link = await within(followups).findByRole('link', {
      name: /Draft the midterm rubric/,
    })
    expect(link).toHaveAttribute('href', '/notifications')
  })

  it('says there is nothing outstanding when the list is empty', async () => {
    setup([repo()], [])
    renderPage()

    const followups = await screen.findByTestId('followup-list')
    expect(await within(followups).findByText(/No active reminders/)).toBeInTheDocument()
  })
})


describe('DashboardPage — repository health map', () => {
  it('names the repository behind each tile on hover', async () => {
    setup([repo()])
    renderPage()

    const donut = await screen.findByLabelText('Health mix')
    const tile = await within(donut).findByRole('link', {
      name: 'student-project · Healthy',
    })
    // The native title is kept as a fallback for the Radix tooltip.
    expect(tile).toHaveAttribute('title', 'student-project · Healthy')
  })
})

describe('DashboardPage — signal balance', () => {
  it('states the 0-2 scale rather than leaving "of 2" unexplained', async () => {
    setup([repo()])
    renderPage()

    const radar = await screen.findByLabelText('Health signal averages')
    expect(await within(radar).findByText(/graded 0–2/)).toBeInTheDocument()
  })
})
