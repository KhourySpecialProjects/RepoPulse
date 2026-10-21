import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { LinearProjectsPanel } from '@/components/dashboard/LinearProjectsPanel'
import type { LinearProject, LinearProjectList, UserDetail } from '@/types'

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

const project = (over: Partial<LinearProject> = {}): LinearProject => ({
  id: 'p-launch',
  name: 'Launch',
  url: 'https://linear.app/acme/project/launch',
  status_name: 'In Progress',
  status_type: 'started',
  progress: 0.45,
  start_date: '2026-09-01',
  target_date: '2026-11-01',
  lead_name: 'Alice',
  team_keys: ['FAL', 'HAW'],
  ...over,
})

function respond(projects: LinearProject[], user: UserDetail = me) {
  const body: LinearProjectList = { items: projects, total: projects.length, limit: 500, offset: 0 }
  server.use(
    http.get('/api/v1/users/me', () => HttpResponse.json(user)),
    http.get('/api/v1/linear/projects', () => HttpResponse.json(body))
  )
}

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <LinearProjectsPanel />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('LinearProjectsPanel', () => {
  it('asks for a Linear key, without calling Linear, when none is configured', async () => {
    let called = false
    server.use(
      http.get('/api/v1/users/me', () => HttpResponse.json({ ...me, linear_api_key_configured: false })),
      http.get('/api/v1/linear/projects', () => {
        called = true
        return HttpResponse.json({ items: [], total: 0, limit: 500, offset: 0 })
      })
    )
    renderPanel()

    const link = await screen.findByRole('link', { name: /add your linear api key/i })
    expect(link).toHaveAttribute('href', '/settings')
    expect(called).toBe(false)
  })

  it('lists each project with its status, progress, due date, lead and teams', async () => {
    respond([project()])
    renderPanel()

    const row = await screen.findByTestId('linear-project')
    const name = within(row).getByRole('link', { name: /launch/i })
    expect(name).toHaveAttribute('href', 'https://linear.app/acme/project/launch')
    expect(name).toHaveAttribute('target', '_blank')
    expect(within(row).getByText('In Progress')).toBeInTheDocument()
    expect(within(row).getByRole('progressbar', { name: /launch progress/i })).toHaveAttribute('aria-valuenow', '45')
    expect(within(row).getByText('45%')).toBeInTheDocument()
    expect(within(row).getByText(/due nov 1/i)).toBeInTheDocument()
    expect(within(row).getByText(/alice/i)).toBeInTheDocument()
    expect(within(row).getByText(/FAL, HAW/)).toBeInTheDocument()
  })

  it('keeps the server order, which puts active work first', async () => {
    respond([project({ id: 'a', name: 'Active' }), project({ id: 'd', name: 'Done', status_type: 'completed', status_name: 'Completed' })])
    renderPanel()

    await screen.findAllByTestId('linear-project')
    const names = screen.getAllByTestId('linear-project').map(row => within(row).getByRole('link').textContent)
    expect(names).toEqual(['Active', 'Done'])
  })

  it('leaves out what a project does not have', async () => {
    respond([project({ target_date: null, lead_name: null, team_keys: [] })])
    renderPanel()

    const row = await screen.findByTestId('linear-project')
    expect(within(row).queryByText(/due/i)).not.toBeInTheDocument()
    expect(within(row).queryByText(/alice/i)).not.toBeInTheDocument()
  })

  it('shows how many projects there are', async () => {
    respond([project({ id: 'a' }), project({ id: 'b', name: 'Docs' })])
    renderPanel()

    expect(await screen.findByTestId('linear-project-count')).toHaveTextContent('2')
  })

  it('says so when the workspace has no projects', async () => {
    respond([])
    renderPanel()

    expect(await screen.findByText(/no projects in your linear workspace/i)).toBeInTheDocument()
  })

  it('explains a rejected Linear key', async () => {
    server.use(
      http.get('/api/v1/users/me', () => HttpResponse.json(me)),
      http.get('/api/v1/linear/projects', () =>
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
      http.get('/api/v1/linear/projects', () =>
        HttpResponse.json({ detail: 'down', error_code: 'linear_unavailable' }, { status: 502 })
      )
    )
    renderPanel()

    expect(await screen.findByText(/couldn't load linear projects/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
  })

  it('scrolls inside its own card rather than growing the page', async () => {
    respond(Array.from({ length: 30 }, (_, i) => project({ id: `p${i}`, name: `Project ${i}` })))
    renderPanel()

    await screen.findAllByTestId('linear-project')
    const list = screen.getByTestId('linear-projects-list')
    expect(list.className).toMatch(/overflow-(y-)?auto/)
    expect(list.className).toContain('min-h-0')
    expect(list.className).toContain('flex-1')
  })
})
