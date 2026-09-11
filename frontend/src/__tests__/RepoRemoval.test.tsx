import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { toast } from 'sonner'
import { server } from '@/mocks/server'
import { RepoCard } from '@/components/RepoCard'
import { RepoDetailPage } from '@/pages/RepoDetailPage'
import type { Repo } from '@/types'

const navigate = vi.hoisted(() => vi.fn())
vi.mock('react-router-dom', async () => ({
  ...await vi.importActual<typeof import('react-router-dom')>('react-router-dom'),
  useNavigate: () => navigate,
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1', role: 'instructor' }, isAuthenticated: true }),
}))

const repo: Repo = {
  id: 'repo-1', collection_id: 'collection-1', name: 'Removal project',
  github_url: 'https://github.com/test/project', local_path: null,
  health_status: 'unknown', health_score: null, last_synced_at: null,
  last_commit_at: null, created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z',
  contributor_count: 1, active_reminder_count: 0, expected_contributor_count: null,
}

function showLocation(location: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  server.use(
    http.get('/api/v1/repos/:id', () => HttpResponse.json(repo)),
    http.get('/api/v1/repos/:id/contributors', () => HttpResponse.json([])),
    http.get('/api/v1/repos/:id/commits', () => HttpResponse.json({ items: [], total: 0, limit: 50, offset: 0 })),
  )
  render(<QueryClientProvider client={client}>
    <MemoryRouter initialEntries={['/repos/repo-1']}>
      <Routes><Route path="/repos/:id" element={location === 'card' ? <RepoCard repo={repo} /> : <RepoDetailPage />} /></Routes>
    </MemoryRouter>
  </QueryClientProvider>)
  return invalidate
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe.each(['card', 'detail'])('Repository removal from %s', location => {
  it('removes the repository after confirmation and refreshes collections', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const deleted = vi.fn()
    server.use(http.delete('/api/v1/repos/:id', ({ params }) => {
      deleted(params.id)
      return HttpResponse.json({ detail: 'Repo deleted' })
    }))
    const invalidate = showLocation(location)
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(deleted).toHaveBeenCalledWith('repo-1'))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Repository removed'))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['collections'] })
    if (location === 'detail') expect(navigate).toHaveBeenCalledWith('/collections/collection-1')
    else expect(navigate).not.toHaveBeenCalled()
  })

  it('shows a failure instead of silently doing nothing', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    server.use(http.delete('/api/v1/repos/:id', () => HttpResponse.json({ detail: 'Failed' }, { status: 500 })))
    showLocation(location)
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Could not remove repository. Please try again.'))
    expect(navigate).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Remove' })).toBeEnabled()
  })
})
