/**
 * A sync started by anyone is visible to everyone looking at the repo.
 *
 * The spinner used to be `useState(false)` with a five-second timeout, so it
 * lived in one browser tab. If a TA synced a project, the instructor's
 * dashboard showed an idle card. The status now rides on the Repo payload, so
 * the card renders whatever the server says regardless of who clicked.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RepoCard } from '@/components/RepoCard'
import type { Repo } from '@/types'

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => vi.fn() }
})

const baseRepo: Repo = {
  id: 'repo-1',
  collection_id: 'col-1',
  github_url: 'https://github.com/student/project',
  name: 'student-project',
  local_path: '/repos/student-project',
  health_status: 'green',
  health_score: null,
  last_commit_at: null,
  last_synced_at: '2026-09-14T14:00:00Z',
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-14T14:00:00Z',
  contributor_count: 3,
  active_reminder_count: 0,
  expected_contributor_count: null,
  sync_status: 'idle',
  sync_started_at: null,
  sync_started_by_name: null,
  sync_error: null,
}

function renderCard(repo: Repo) {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <RepoCard repo={repo} weeklyCommits={[]} />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('shared sync status on a repo card', () => {
  it('says nothing when the repo is idle', () => {
    renderCard(baseRepo)
    expect(screen.queryByTestId('sync-indicator')).not.toBeInTheDocument()
  })

  it("shows another person's in-flight sync, and names them", () => {
    renderCard({
      ...baseRepo,
      sync_status: 'syncing',
      sync_started_at: '2026-09-14T15:00:00Z',
      sync_started_by_name: 'Tina TA',
    })

    const indicator = screen.getByTestId('sync-indicator')
    expect(indicator).toHaveTextContent(/syncing/i)
    expect(indicator).toHaveTextContent('Tina TA')
  })

  it('surfaces a failed sync so it is not silently stale', () => {
    renderCard({
      ...baseRepo,
      sync_status: 'failed',
      sync_error: 'authentication failed',
    })

    const indicator = screen.getByTestId('sync-indicator')
    expect(indicator).toHaveTextContent(/sync failed/i)
  })
})
