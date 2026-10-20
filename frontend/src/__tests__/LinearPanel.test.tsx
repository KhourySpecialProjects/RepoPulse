import { describe, it, expect } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { LinearPanel } from '@/components/LinearPanel'
import type { RepoLinear, LinearTeamList } from '@/types'

function renderPanel(repoId = 'repo-1') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <LinearPanel repoId={repoId} />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

function respondWith(body: RepoLinear) {
  server.use(http.get('/api/v1/repos/:id/linear', () => HttpResponse.json(body)))
}

const okResponse: RepoLinear = {
  status: 'ok',
  team: { id: 't-falcon', key: 'FAL', name: 'Falcon' },
  matched_by: 'auto',
  can_change_team: true,
  stats: {
    status_counts: { triage: 0, backlog: 3, unstarted: 2, started: 1, completed: 4, canceled: 1 },
    total_issues: 11,
    active_cycle: {
      number: 4,
      name: 'Sprint 4',
      starts_at: '2026-10-12T12:00:00Z',
      ends_at: '2026-10-26T12:00:00Z',
      progress: 0.5,
      issue_count: 2,
      completed_issue_count: 1,
    },
    completed_per_week: [
      { week_start: '2026-09-14', completed: 0 },
      { week_start: '2026-09-21', completed: 1 },
      { week_start: '2026-09-28', completed: 0 },
      { week_start: '2026-10-05', completed: 0 },
      { week_start: '2026-10-12', completed: 1 },
      { week_start: '2026-10-19', completed: 2 },
    ],
    members: [
      { name: 'Alice', open: 1, completed: 3 },
      { name: 'Unassigned', open: 2, completed: 0 },
    ],
  },
}

const teams: LinearTeamList = {
  items: [
    { id: 't-falcon', key: 'FAL', name: 'Falcon' },
    { id: 't-hawk', key: 'HAW', name: 'Hawk' },
  ],
  total: 2,
  limit: 100,
  offset: 0,
}

describe('LinearPanel', () => {
  it('asks for a Linear key when the viewer has none', async () => {
    respondWith({ status: 'not_configured', team: null, matched_by: null, stats: null, can_change_team: true })
    renderPanel()

    const link = await screen.findByRole('link', { name: /add your linear api key/i })
    expect(link).toHaveAttribute('href', '/settings')
    expect(screen.queryByRole('button', { name: /link a linear team/i })).not.toBeInTheDocument()
  })

  it('shows the "Linear info soon" placeholder when no team matches', async () => {
    respondWith({ status: 'no_team', team: null, matched_by: null, stats: null, can_change_team: false })
    renderPanel()

    expect(await screen.findByText('Linear info soon')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /link a linear team/i })).not.toBeInTheDocument()
  })

  it('says when the linked team is not visible to the viewer', async () => {
    respondWith({ status: 'no_team', team: null, matched_by: 'manual', stats: null, can_change_team: false })
    renderPanel()

    expect(await screen.findByText('Linear info soon')).toBeInTheDocument()
    expect(screen.getByText(/linked team isn't visible/i)).toBeInTheDocument()
  })

  it('shows the team and how it was matched', async () => {
    respondWith(okResponse)
    renderPanel()

    expect(await screen.findByText('Falcon')).toBeInTheDocument()
    expect(screen.getByText('FAL')).toBeInTheDocument()
    expect(screen.getByText(/matched by repo name/i)).toBeInTheDocument()
  })

  it('labels a hand-picked team as linked', async () => {
    respondWith({ ...okResponse, matched_by: 'manual' })
    renderPanel()

    expect(await screen.findByText(/^linked$/i)).toBeInTheDocument()
  })

  it('renders the issue status breakdown', async () => {
    respondWith(okResponse)
    renderPanel()

    expect(await screen.findByTestId('linear-status-backlog')).toHaveTextContent('3')
    expect(screen.getByTestId('linear-status-backlog')).toHaveTextContent('Backlog')
    expect(screen.getByTestId('linear-status-unstarted')).toHaveTextContent('Todo')
    expect(screen.getByTestId('linear-status-started')).toHaveTextContent('In Progress')
    expect(screen.getByTestId('linear-status-completed')).toHaveTextContent('4')
    expect(screen.getByTestId('linear-status-completed')).toHaveTextContent('Done')
  })

  it('renders active cycle progress', async () => {
    respondWith(okResponse)
    renderPanel()

    expect(await screen.findByText(/cycle 4/i)).toBeInTheDocument()
    expect(screen.getByText(/sprint 4/i)).toBeInTheDocument()
    expect(screen.getByText('1 of 2 issues done')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: /cycle progress/i })).toHaveAttribute('aria-valuenow', '50')
  })

  it('says when there is no active cycle', async () => {
    respondWith({ ...okResponse, stats: { ...okResponse.stats!, active_cycle: null } })
    renderPanel()

    expect(await screen.findByText(/no active cycle/i)).toBeInTheDocument()
  })

  it('offers the weekly completions as a table', async () => {
    const user = userEvent.setup()
    respondWith(okResponse)
    renderPanel()

    await user.click(await screen.findByRole('button', { name: /show table/i }))
    const table = screen.getByRole('table', { name: /issues completed per week/i })
    const rows = within(table).getAllByRole('row')
    // Header + six weeks, newest last.
    expect(rows).toHaveLength(7)
    expect(rows[6]).toHaveTextContent('Oct 19')
    expect(rows[6]).toHaveTextContent('2')
  })

  it('lists open and completed issues per member', async () => {
    respondWith(okResponse)
    renderPanel()

    const table = await screen.findByRole('table', { name: /issues per member/i })
    const alice = within(table).getByRole('row', { name: /alice/i })
    expect(alice).toHaveTextContent('1')
    expect(alice).toHaveTextContent('3')
    expect(within(table).getByRole('row', { name: /unassigned/i })).toBeInTheDocument()
  })

  it('explains a rejected Linear key', async () => {
    server.use(
      http.get('/api/v1/repos/:id/linear', () =>
        HttpResponse.json(
          { detail: 'Linear rejected your API key. Update it in Settings.', error_code: 'linear_key_invalid' },
          { status: 400 }
        )
      )
    )
    renderPanel()

    expect(await screen.findByText(/linear rejected your api key/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /update it in settings/i })).toHaveAttribute('href', '/settings')
  })

  it('offers a retry when Linear is unreachable', async () => {
    server.use(
      http.get('/api/v1/repos/:id/linear', () =>
        HttpResponse.json(
          { detail: 'Linear could not be reached.', error_code: 'linear_unavailable' },
          { status: 502 }
        )
      )
    )
    renderPanel()

    expect(await screen.findByText(/couldn't load linear/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
  })

  it('hides the team picker from viewers who cannot change it', async () => {
    respondWith({ ...okResponse, can_change_team: false })
    renderPanel()

    await screen.findByText('Falcon')
    expect(screen.queryByRole('button', { name: /change team/i })).not.toBeInTheDocument()
  })

  it('links a different team from the picker', async () => {
    const user = userEvent.setup()
    let patched: unknown = null
    respondWith(okResponse)
    server.use(
      http.get('/api/v1/linear/teams', () => HttpResponse.json(teams)),
      http.patch('/api/v1/repos/:id', async ({ request }) => {
        patched = await request.json()
        return HttpResponse.json({ id: 'repo-1', linear_team_id: 't-hawk' })
      })
    )
    renderPanel()

    await user.click(await screen.findByRole('button', { name: /change team/i }))
    const select = await screen.findByRole('combobox', { name: /linear team/i })
    await screen.findByRole('option', { name: /hawk/i })
    await user.selectOptions(select, 't-hawk')

    await waitFor(() => expect(patched).toEqual({ linear_team_id: 't-hawk' }))
  })

  it('returns the repo to auto-detection from the picker', async () => {
    const user = userEvent.setup()
    let patched: unknown = null
    respondWith({ ...okResponse, matched_by: 'manual' })
    server.use(
      http.get('/api/v1/linear/teams', () => HttpResponse.json(teams)),
      http.patch('/api/v1/repos/:id', async ({ request }) => {
        patched = await request.json()
        return HttpResponse.json({ id: 'repo-1', linear_team_id: null })
      })
    )
    renderPanel()

    await user.click(await screen.findByRole('button', { name: /change team/i }))
    const select = await screen.findByRole('combobox', { name: /linear team/i })
    await screen.findByRole('option', { name: /hawk/i })
    await user.selectOptions(select, '')

    await waitFor(() => expect(patched).toEqual({ linear_team_id: null }))
  })

  it('lets an owner link a team when none was matched', async () => {
    const user = userEvent.setup()
    respondWith({ status: 'no_team', team: null, matched_by: null, stats: null, can_change_team: true })
    server.use(http.get('/api/v1/linear/teams', () => HttpResponse.json(teams)))
    renderPanel()

    expect(await screen.findByText('Linear info soon')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /link a linear team/i }))
    expect(await screen.findByRole('option', { name: /falcon/i })).toBeInTheDocument()
  })
})
