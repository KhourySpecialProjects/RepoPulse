import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CollectionCommitActivityChart } from '@/components/CollectionCommitActivityChart'
import * as api from '@/services/api'
import type { CollectionCommitActivity } from '@/types'

vi.mock('@/services/api', async () => {
  const actual = await vi.importActual<typeof import('@/services/api')>('@/services/api')
  return { ...actual, getCollectionCommitActivity: vi.fn() }
})

const mockGetCollectionCommitActivity = vi.mocked(api.getCollectionCommitActivity)

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

function renderChart(collectionId = 'col-1') {
  return render(
    <QueryClientProvider client={makeClient()}>
      <CollectionCommitActivityChart collectionId={collectionId} />
    </QueryClientProvider>
  )
}

function recentDate(daysAgo: number): string {
  const d = new Date(Date.now() - daysAgo * 86400000)
  return d.toISOString().slice(0, 10)
}

const mockActivity: CollectionCommitActivity = {
  activity: [
    { date: recentDate(10), count: 5 },
    { date: recentDate(7), count: 3 },
    { date: recentDate(4), count: 7 },
    { date: recentDate(1), count: 2 },
  ],
}

describe('CollectionCommitActivityChart', () => {
  beforeEach(() => {
    mockGetCollectionCommitActivity.mockReset()
  })

  it('renders card title', () => {
    mockGetCollectionCommitActivity.mockReturnValue(new Promise(() => {}))
    renderChart()
    expect(screen.getByText('Collection Commit Activity')).toBeInTheDocument()
  })

  it('shows loading skeleton while fetching', () => {
    mockGetCollectionCommitActivity.mockReturnValue(new Promise(() => {}))
    renderChart()
    expect(screen.getByTestId('commit-activity-skeleton')).toBeInTheDocument()
  })

  it('calls getCollectionCommitActivity with correct collectionId', async () => {
    mockGetCollectionCommitActivity.mockResolvedValue(mockActivity)
    renderChart('col-42')
    await waitFor(() =>
      expect(mockGetCollectionCommitActivity).toHaveBeenCalledWith('col-42')
    )
  })

  it('renders the chart area after data loads', async () => {
    mockGetCollectionCommitActivity.mockResolvedValue(mockActivity)
    renderChart()
    expect(await screen.findByTestId('commit-activity-chart')).toBeInTheDocument()
  })

  it('shows empty state when activity array is empty', async () => {
    mockGetCollectionCommitActivity.mockResolvedValue({ activity: [] })
    renderChart()
    expect(await screen.findByText(/no commit data available/i)).toBeInTheDocument()
  })

  it('renders time range selector buttons', async () => {
    mockGetCollectionCommitActivity.mockResolvedValue(mockActivity)
    renderChart()
    expect(await screen.findByRole('button', { name: '7d' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '30d' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '90d' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'All' })).toBeInTheDocument()
  })

  it('highlights the active range button', async () => {
    mockGetCollectionCommitActivity.mockResolvedValue(mockActivity)
    renderChart()
    // Default range is 30d
    const thirtyBtn = await screen.findByRole('button', { name: '30d' })
    expect(thirtyBtn.className).toContain('bg-indigo-600')
  })

  it('switches active range when a button is clicked', async () => {
    mockGetCollectionCommitActivity.mockResolvedValue(mockActivity)
    renderChart()
    await screen.findByRole('button', { name: '7d' })
    fireEvent.click(screen.getByRole('button', { name: '7d' }))
    expect(screen.getByRole('button', { name: '7d' }).className).toContain('bg-indigo-600')
    expect(screen.getByRole('button', { name: '30d' }).className).not.toContain('bg-indigo-600')
  })

  it('shows empty state when all filtered points have zero commits', async () => {
    // Activity is old enough that 7d filter removes everything
    const oldActivity: CollectionCommitActivity = {
      activity: [
        { date: '2020-01-01', count: 5 },
        { date: '2020-01-02', count: 3 },
      ],
    }
    mockGetCollectionCommitActivity.mockResolvedValue(oldActivity)
    renderChart()
    // Selecting 7d should show empty state since data is from 2020
    await screen.findByRole('button', { name: '7d' })
    fireEvent.click(screen.getByRole('button', { name: '7d' }))
    expect(await screen.findByText(/no commit data available/i)).toBeInTheDocument()
  })
})
