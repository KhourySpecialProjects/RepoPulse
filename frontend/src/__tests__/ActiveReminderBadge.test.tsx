import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RepoCard } from '@/components/RepoCard'
import type { Repo } from '@/types'

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

const baseRepo: Repo = {
  id: 'repo-1',
  collection_id: 'col-1',
  github_url: 'https://github.com/student/project',
  name: 'student-project',
  local_path: '/repos/student-project',
  health_status: 'green',
  health_score: null,
  last_synced_at: '2025-10-14T14:00:00Z',
  created_at: '2025-09-01T00:00:00Z',
  updated_at: '2025-10-14T14:00:00Z',
  contributor_count: 3,
  expected_contributor_count: null,
  active_reminder_count: 0,
}

function renderCard(repo: Repo) {
  const queryClient = makeQueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <RepoCard repo={repo} weeklyCommits={[]} />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('RepoCard — active reminder badge', () => {
  beforeEach(() => {
    mockNavigate.mockClear()
  })

  it('does not show reminder badge when active_reminder_count is 0', () => {
    renderCard({ ...baseRepo, active_reminder_count: 0 })
    expect(screen.queryByText(/reminder/i)).not.toBeInTheDocument()
  })

  it('shows singular "reminder" when count is 1', () => {
    renderCard({ ...baseRepo, active_reminder_count: 1 })
    expect(screen.getByText('1 reminder')).toBeInTheDocument()
  })

  it('shows plural "reminders" when count is more than 1', () => {
    renderCard({ ...baseRepo, active_reminder_count: 3 })
    expect(screen.getByText('3 reminders')).toBeInTheDocument()
  })

  it('renders Bell icon when there are active reminders', () => {
    const { container } = renderCard({ ...baseRepo, active_reminder_count: 2 })
    // lucide Bell icon renders as an SVG inside the span with amber color class
    const badge = container.querySelector('.text-amber-600')
    expect(badge).not.toBeNull()
  })
})
