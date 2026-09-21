import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { RepoDetailPage } from '@/pages/RepoDetailPage'
import type { HealthScore, Repo } from '@/types'

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

const healthScore: HealthScore = {
  commit_frequency: 2,
  recency: 1,
  distribution: 0,
  branch_activity: 2,
  commit_message_quality: 1,
  participation: 0,
  composite: 0.74,
  status: 'yellow',
}

const mockRepo: Repo = {
  id: 'repo-1',
  collection_id: 'col-1',
  github_url: 'https://github.com/student/project',
  name: 'student-project',
  local_path: '/repos/student-project',
  health_status: 'yellow',
  health_score: healthScore,
  last_synced_at: '2025-10-15T10:00:00Z',
  last_commit_at: '2025-10-14T14:00:00Z',
  created_at: '2025-09-01T00:00:00Z',
  updated_at: '2025-10-15T10:00:00Z',
  contributor_count: 2,
  active_reminder_count: 0,
  expected_contributor_count: null,
  sync_status: 'idle',
  sync_started_at: null,
  sync_started_by_name: null,
  sync_error: null,
}

function setupHandlers() {
  server.use(
    http.get('/api/v1/repos/:id', () => HttpResponse.json(mockRepo)),
    http.get('/api/v1/repos/:id/health', () => HttpResponse.json(healthScore)),
    http.get('/api/v1/repos/:id/commits', () =>
      HttpResponse.json({ items: [], total: 0, limit: 500, offset: 0 })
    ),
    http.get('/api/v1/repos/:id/contributors', () => HttpResponse.json([])),
    http.get('/api/v1/repos/:id/summaries', () => HttpResponse.json([])),
    http.get('/api/v1/notes', () =>
      HttpResponse.json({ items: [], total: 0, limit: 50, offset: 0 })
    )
  )
}

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/repos/repo-1']}>
        <Routes>
          <Route path="/repos/:id" element={<RepoDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

/**
 * The signal breakdown was moved out of a header disclosure and onto the
 * Commit Activity card. A devTesting merge once resolved this file in favour of
 * the old header, which left HealthSignalPills present but never rendered — so
 * the wiring itself is what needs a test, not just the component.
 */
describe('RepoDetailPage — health signals on the activity card', () => {
  it('renders the signal pills rather than a Health details disclosure', async () => {
    setupHandlers()
    renderPage()
    await waitFor(() => expect(screen.getByText('student-project')).toBeInTheDocument())

    expect(await screen.findByText('Frequency')).toBeInTheDocument()
    ;['Recency', 'Distribution', 'Branches', 'Msg Quality', 'Participation'].forEach(label =>
      expect(screen.getByText(label)).toBeInTheDocument()
    )
    expect(screen.queryByText('Health details')).not.toBeInTheDocument()
  })

  it('places the pills inside the Commit Activity card, not the page header', async () => {
    setupHandlers()
    renderPage()
    // Anchor on the range select: it only exists inside the activity card, so
    // closest('.rounded-lg') from there is that Card and nothing wider.
    const rangeSelect = await screen.findByLabelText('Activity range')
    const activityCard = rangeSelect.closest('.rounded-lg') as HTMLElement
    expect(activityCard).not.toBeNull()
    expect(within(activityCard).getByText('Commit Activity')).toBeInTheDocument()
    expect(within(activityCard).getByText('Frequency')).toBeInTheDocument()

    // And the header it moved out of no longer carries the breakdown.
    const header = screen.getByTestId('page-header')
    expect(within(header).queryByText('Frequency')).not.toBeInTheDocument()
    expect(header.contains(activityCard)).toBe(false)
  })

  it('keeps the composite score in the page header', async () => {
    setupHandlers()
    renderPage()
    // 0.74 composite reads as 74/100 next to the status badge.
    expect(await screen.findByText('74/100')).toBeInTheDocument()
  })
})
