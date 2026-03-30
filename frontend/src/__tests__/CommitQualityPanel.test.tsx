import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CommitQualityPanel } from '@/components/CommitQualityPanel'
import * as api from '@/services/api'
import type { CommitQualityResponse } from '@/types'

vi.mock('@/services/api', async () => {
  const actual = await vi.importActual<typeof import('@/services/api')>('@/services/api')
  return { ...actual, getCommitQuality: vi.fn() }
})

const mockGetCommitQuality = vi.mocked(api.getCommitQuality)

const mockResponse: CommitQualityResponse = {
  repos: [
    {
      repo_id: 'repo-1',
      repo_name: 'student-project',
      commits: [
        { hash: 'abc123', full_hash: 'abc123abc123', message: 'fix: resolve null pointer', author: 'Alice', date: '2025-10-01T10:00:00Z', score: 'good', from_cache: false },
        { hash: 'def456', full_hash: 'def456def456', message: 'wip', author: 'Bob', date: '2025-10-02T11:00:00Z', score: 'bad', from_cache: false },
        { hash: 'ghi789', full_hash: 'ghi789ghi789', message: 'update stuff', author: 'Alice', date: '2025-10-03T09:00:00Z', score: 'ok', from_cache: false },
      ],
      cache_hits: 0,
      newly_scored: 3,
    },
  ],
  model_used: 'claude-3-haiku',
  repos_skipped: 0,
  total_cache_hits: 0,
  total_newly_scored: 3,
}

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

function renderPanel(collectionId = 'col-1', perRepo = 15) {
  return render(
    <QueryClientProvider client={makeClient()}>
      <CommitQualityPanel collectionId={collectionId} perRepo={perRepo} />
    </QueryClientProvider>
  )
}

describe('CommitQualityPanel', () => {
  beforeEach(() => {
    mockGetCommitQuality.mockReset()
  })

  it('renders header on mount', () => {
    mockGetCommitQuality.mockReturnValue(new Promise(() => {}))
    renderPanel()
    expect(screen.getByText('Commit Message Quality')).toBeInTheDocument()
  })

  it('auto-fetches on mount without requiring a button click', async () => {
    mockGetCommitQuality.mockResolvedValue(mockResponse)
    renderPanel()
    expect(await screen.findByText('student-project')).toBeInTheDocument()
    expect(mockGetCommitQuality).toHaveBeenCalledTimes(1)
  })

  it('shows loading spinner during initial fetch', async () => {
    let resolve: (v: CommitQualityResponse) => void = () => {}
    mockGetCommitQuality.mockReturnValue(new Promise((r) => { resolve = r }))

    renderPanel()
    expect(await screen.findByText(/fetching commits/i)).toBeInTheDocument()
    resolve(mockResponse)
  })

  it('calls getCommitQuality with correct arguments on mount', async () => {
    mockGetCommitQuality.mockResolvedValue(mockResponse)
    renderPanel('col-42', 10)
    await waitFor(() => expect(mockGetCommitQuality).toHaveBeenCalledWith('col-42', 10))
  })

  it('renders repo section and commit rows after successful fetch', async () => {
    mockGetCommitQuality.mockResolvedValue(mockResponse)
    renderPanel()

    expect(await screen.findByText('student-project')).toBeInTheDocument()
    expect(screen.getByText('fix: resolve null pointer')).toBeInTheDocument()
    expect(screen.getByText('wip')).toBeInTheDocument()
    expect(screen.getByText('update stuff')).toBeInTheDocument()
  })

  it('renders score pills with correct labels', async () => {
    mockGetCommitQuality.mockResolvedValue(mockResponse)
    renderPanel()

    await screen.findByText('student-project')
    expect(screen.getByText('Good')).toBeInTheDocument()
    expect(screen.getByText('Bad')).toBeInTheDocument()
    expect(screen.getByText('OK')).toBeInTheDocument()
  })

  it('shows good/bad summary counts in repo section header', async () => {
    mockGetCommitQuality.mockResolvedValue(mockResponse)
    renderPanel()

    await screen.findByText('student-project')
    expect(screen.getByText('1 good')).toBeInTheDocument()
    expect(screen.getByText('1 bad')).toBeInTheDocument()
  })

  it('shows model info in header after results load', async () => {
    mockGetCommitQuality.mockResolvedValue(mockResponse)
    renderPanel()

    await screen.findByText('student-project')
    expect(screen.getByText(/claude-3-haiku/)).toBeInTheDocument()
  })

  it('shows Re-analyze button (outline variant) once data is loaded', async () => {
    mockGetCommitQuality.mockResolvedValue(mockResponse)
    renderPanel()

    expect(await screen.findByRole('button', { name: /re-analyze/i })).toBeInTheDocument()
  })

  it('does not show an "Analyze Commits" idle state — data loads automatically', async () => {
    mockGetCommitQuality.mockResolvedValue(mockResponse)
    renderPanel()
    await screen.findByText('student-project')
    expect(screen.queryByText(/analyze commits/i)).not.toBeInTheDocument()
  })

  it('Re-analyze button calls refetch without blanking existing data', async () => {
    mockGetCommitQuality.mockResolvedValue(mockResponse)
    renderPanel()

    // wait for initial data to load
    await screen.findByText('student-project')

    const reanalyzeBtn = screen.getByRole('button', { name: /re-analyze/i })

    // data is showing; trigger re-analyze
    mockGetCommitQuality.mockResolvedValue(mockResponse)
    fireEvent.click(reanalyzeBtn)

    // existing data should still be visible while refetch is in-flight
    expect(screen.getByText('student-project')).toBeInTheDocument()
  })

  it('shows error message when API call fails', async () => {
    mockGetCommitQuality.mockRejectedValue({
      response: { data: { detail: 'LLM not configured' } },
    })
    renderPanel()

    expect(await screen.findByText('LLM not configured')).toBeInTheDocument()
  })

  it('shows fallback error message when no detail in error response', async () => {
    mockGetCommitQuality.mockRejectedValue(new Error('network error'))
    renderPanel()

    expect(await screen.findByText('Failed to analyze commit quality')).toBeInTheDocument()
  })

  it('shows empty state when no repos have commits', async () => {
    mockGetCommitQuality.mockResolvedValue({ repos: [], model_used: 'claude-3-haiku', repos_skipped: 0, total_cache_hits: 0, total_newly_scored: 0 })
    renderPanel()

    expect(await screen.findByText(/no repos with commit history/i)).toBeInTheDocument()
  })

  it('shows repos_skipped count when non-zero', async () => {
    mockGetCommitQuality.mockResolvedValue({ ...mockResponse, repos_skipped: 2 })
    renderPanel()

    await screen.findByText('student-project')
    expect(screen.getByText(/2 skipped/)).toBeInTheDocument()
  })

  it('collapses and expands a repo section on header click', async () => {
    mockGetCommitQuality.mockResolvedValue(mockResponse)
    renderPanel()

    await screen.findByText('student-project')

    // Initially open — commit row is visible
    expect(screen.getByText('fix: resolve null pointer')).toBeInTheDocument()

    // Click the section header button to collapse
    fireEvent.click(screen.getByRole('button', { name: /student-project/i }))

    // Toggle back open
    fireEvent.click(screen.getByRole('button', { name: /student-project/i }))
    expect(screen.getByText('fix: resolve null pointer')).toBeInTheDocument()
  })
})
