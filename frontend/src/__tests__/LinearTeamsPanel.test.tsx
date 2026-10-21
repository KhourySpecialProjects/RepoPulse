import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { LinearTeamsPanel } from '@/components/dashboard/LinearTeamsPanel'
import type { LinearTeamStats, RepoLinearTeam, RepoLinearTeamList, UserDetail } from '@/types'

const me: UserDetail = {
  id: 'user-instructor-1',
  email: 'mark@example.com',
  display_name: 'Mark',
  role: 'instructor',
  github_token_configured: true,
  linear_api_key_configured: true,
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
}

const stats = (over: Partial<LinearTeamStats> = {}): LinearTeamStats => ({
  status_counts: { triage: 1, backlog: 2, unstarted: 1, started: 2, completed: 9, canceled: 1 },
  total_issues: 16,
  active_cycle: {
    number: 4,
    name: 'Sprint 4',
    starts_at: '2026-10-12T12:00:00Z',
    ends_at: '2026-10-26T12:00:00Z',
    progress: 0.5,
    issue_count: 4,
    completed_issue_count: 2,
  },
  completed_per_week: [],
  members: [],
  ...over,
})

const row = (over: Partial<RepoLinearTeam> = {}): RepoLinearTeam => ({
  repo_id: 'repo-1',
  repo_name: 'team-falcon',
  collection_id: 'col-1',
  team: { id: 't-falcon', key: 'FAL', name: 'Falcon' },
  matched_by: 'auto',
  stats: stats(),
  ...over,
})

function respond(items: RepoLinearTeam[], onRequest?: (url: URL) => void) {
  const body: RepoLinearTeamList = { items, total: items.length, limit: 500, offset: 0 }
  server.use(
    http.get('/api/v1/users/me', () => HttpResponse.json(me)),
    http.get('/api/v1/linear/repo-teams', ({ request }) => {
      onRequest?.(new URL(request.url))
      return HttpResponse.json(body)
    })
  )
}

function renderPanel(collectionId = '') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <LinearTeamsPanel collectionId={collectionId} />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('LinearTeamsPanel', () => {
  it('asks for a Linear key, without calling Linear, when none is configured', async () => {
    let called = false
    server.use(
      http.get('/api/v1/users/me', () => HttpResponse.json({ ...me, linear_api_key_configured: false })),
      http.get('/api/v1/linear/repo-teams', () => {
        called = true
        return HttpResponse.json({ items: [], total: 0, limit: 500, offset: 0 })
      })
    )
    renderPanel()

    const link = await screen.findByRole('link', { name: /add your linear api key/i })
    expect(link).toHaveAttribute('href', '/settings')
    expect(called).toBe(false)
  })

  it('lists each repo with the Linear team it shows', async () => {
    respond([row()])
    renderPanel()

    const item = await screen.findByTestId('linear-repo-team')
    expect(within(item).getByRole('link', { name: /team-falcon/i })).toHaveAttribute('href', '/repos/repo-1')
    expect(within(item).getByText('Falcon')).toBeInTheDocument()
    expect(within(item).getByText('FAL')).toBeInTheDocument()
  })

  it('summarizes the team’s issues', async () => {
    respond([row()])
    renderPanel()

    const item = await screen.findByTestId('linear-repo-team')
    // Open is everything not done or canceled: triage + backlog + todo + in progress.
    expect(within(item).getByText('6 open · 2 in progress · 9 done')).toBeInTheDocument()
  })

  it('shows the active cycle’s progress', async () => {
    respond([row()])
    renderPanel()

    const item = await screen.findByTestId('linear-repo-team')
    expect(within(item).getByText(/cycle 4/i)).toBeInTheDocument()
    expect(within(item).getByRole('progressbar', { name: /team-falcon cycle progress/i })).toHaveAttribute('aria-valuenow', '50')
  })

  it('leaves the cycle out when the team has none running', async () => {
    respond([row({ stats: stats({ active_cycle: null }) })])
    renderPanel()

    const item = await screen.findByTestId('linear-repo-team')
    expect(within(item).queryByRole('progressbar')).not.toBeInTheDocument()
    expect(within(item).queryByText(/cycle/i)).not.toBeInTheDocument()
  })

  it('shows how many repos are on Linear', async () => {
    respond([row(), row({ repo_id: 'repo-2', repo_name: 'falcon-web' })])
    renderPanel()

    expect(await screen.findByTestId('linear-repo-team-count')).toHaveTextContent('2')
  })

  it('says so when no repo has a Linear team yet', async () => {
    respond([])
    renderPanel()

    expect(await screen.findByText('No Linear teams linked yet.')).toBeInTheDocument()
  })

  it('follows the dashboard’s collection picker', async () => {
    const seen: (string | null)[] = []
    respond([row()], url => seen.push(url.searchParams.get('collection_id')))
    const { unmount } = renderPanel('col-2')
    await screen.findByTestId('linear-repo-team')
    unmount()

    respond([row()], url => seen.push(url.searchParams.get('collection_id')))
    renderPanel('')
    await screen.findByTestId('linear-repo-team')

    // A scoped picker sends the collection; "All collections" sends none.
    expect(seen).toEqual(['col-2', null])
  })

  it('explains a rejected Linear key', async () => {
    server.use(
      http.get('/api/v1/users/me', () => HttpResponse.json(me)),
      http.get('/api/v1/linear/repo-teams', () =>
        HttpResponse.json({ detail: 'rejected', error_code: 'linear_key_invalid' }, { status: 400 })
      )
    )
    renderPanel()

    expect(await screen.findByText(/linear rejected your api key/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /update it in settings/i })).toHaveAttribute('href', '/settings')
  })

  it('offers a retry when Linear is unreachable', async () => {
    server.use(
      http.get('/api/v1/users/me', () => HttpResponse.json(me)),
      http.get('/api/v1/linear/repo-teams', () =>
        HttpResponse.json({ detail: 'down', error_code: 'linear_unavailable' }, { status: 502 })
      )
    )
    renderPanel()

    expect(await screen.findByText(/couldn't load linear/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
  })

  it('scrolls inside its own card rather than growing the page', async () => {
    respond(Array.from({ length: 30 }, (_, i) => row({ repo_id: `r${i}`, repo_name: `repo-${i}` })))
    renderPanel()

    await screen.findAllByTestId('linear-repo-team')
    const list = screen.getByTestId('linear-repo-teams-list')
    expect(list.className).toMatch(/overflow-(y-)?auto/)
    expect(list.className).toContain('min-h-0')
    expect(list.className).toContain('flex-1')
  })
})
