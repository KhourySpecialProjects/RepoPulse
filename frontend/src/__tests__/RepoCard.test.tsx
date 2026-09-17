import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
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

const mockRepo: Repo = {
  id: 'repo-1',
  collection_id: 'col-1',
  github_url: 'https://github.com/student/project',
  name: 'student-project',
  local_path: '/repos/student-project',
  health_status: 'green',
  health_score: null,
  last_commit_at: null,
  last_synced_at: '2025-10-14T14:00:00Z',
  created_at: '2025-09-01T00:00:00Z',
  updated_at: '2025-10-14T14:00:00Z',
  contributor_count: 3,
  active_reminder_count: 0,
  expected_contributor_count: null,
  sync_status: 'idle',
  sync_started_at: null,
  sync_started_by_name: null,
  sync_error: null,
}

function renderCard(repo: Repo = mockRepo, weeklyCommits: number[] = []) {
  const queryClient = makeQueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <RepoCard repo={repo} weeklyCommits={weeklyCommits} />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('RepoCard', () => {
  beforeEach(() => {
    mockNavigate.mockClear()
  })

  it('renders repo name', () => {
    renderCard()
    expect(screen.getByText('student-project')).toBeInTheDocument()
  })

  it('renders health badge with correct status', () => {
    renderCard()
    expect(screen.getByText('Healthy')).toBeInTheDocument()
  })

  it('renders contributor count', () => {
    renderCard()
    expect(screen.getByText(/3 contributors/)).toBeInTheDocument()
  })

  it('renders GitHub button', () => {
    renderCard()
    expect(screen.getByRole('button', { name: /github/i })).toBeInTheDocument()
  })

  it('renders VS Code button', () => {
    renderCard()
    expect(screen.getByRole('button', { name: /vs code/i })).toBeInTheDocument()
  })

  it('opens the repo in vscode.dev, not a local clone path', () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null)
    renderCard()
    fireEvent.click(screen.getByRole('button', { name: /vs code/i }))
    expect(openSpy).toHaveBeenCalledWith(
      'https://vscode.dev/github/student/project',
      '_blank',
      'noopener,noreferrer'
    )
    openSpy.mockRestore()
  })

  // The button used to be gated on local_path, which is the path *inside* the
  // backend container. It resolved on no user's machine, and on a public
  // deployment the clones sit in a Docker volume no browser can reach. The URL
  // now comes from github_url alone, so a repo that was never cloned still opens.
  it('VS Code button stays enabled when there is no local clone', () => {
    renderCard({ ...mockRepo, local_path: null })
    expect(screen.getByRole('button', { name: /vs code/i })).toBeEnabled()
  })

  it('VS Code button is disabled when the repo URL is not a GitHub URL', () => {
    renderCard({ ...mockRepo, github_url: 'https://gitlab.com/student/project' })
    expect(screen.getByRole('button', { name: /vs code/i })).toBeDisabled()
  })

  it('navigates to repo detail on card click', () => {
    renderCard()
    // Click the card itself (not a button)
    const heading = screen.getByText('student-project')
    fireEvent.click(heading.closest('[class*="cursor-pointer"]')!)
    // The origin rides along so the repo page's back arrow returns to the page
    // the card was clicked on. MemoryRouter defaults to "/" here.
    expect(mockNavigate).toHaveBeenCalledWith('/repos/repo-1', { state: { from: '/' } })
  })

  it('renders critical badge for red status', () => {
    renderCard({ ...mockRepo, health_status: 'red' })
    expect(screen.getByText('Critical')).toBeInTheDocument()
  })

  it('renders at risk badge for yellow status', () => {
    renderCard({ ...mockRepo, health_status: 'yellow' })
    expect(screen.getByText('At Risk')).toBeInTheDocument()
  })
})

describe('RepoCard — Remove action', () => {
  beforeEach(() => {
    mockNavigate.mockClear()
    vi.spyOn(window, 'confirm').mockReturnValue(false)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders a Remove button', () => {
    renderCard()
    expect(screen.getByRole('button', { name: /remove/i })).toBeInTheDocument()
  })

  it('shows a confirm dialog when Remove is clicked', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderCard()
    fireEvent.click(screen.getByRole('button', { name: /remove/i }))
    expect(confirmSpy).toHaveBeenCalledWith('Remove this repository?')
  })

  it('does not navigate when confirm is cancelled', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderCard()
    fireEvent.click(screen.getByRole('button', { name: /remove/i }))
    expect(mockNavigate).not.toHaveBeenCalled()
  })
})
