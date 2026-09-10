import { render, screen } from '@testing-library/react'
import { vi, it, expect, afterEach } from 'vitest'
import { ContextualActivityChart } from '@/components/ContextualActivityChart'
vi.mock('@/hooks/useContextualActivity', () => ({ useContextualActivity: () => ({ data: { repositories: [{ id: 'repo', name: 'Repo', available: true, activity: [{ date: '2026-09-01', count: 1 }], students: [{ id: 'bob', name: 'Bob', activity: [] }, { id: 'alice', name: 'Alice', activity: [{ date: '2026-09-01', count: 1 }] }] }] }, isLoading: false }) }))
afterEach(() => vi.useRealTimers())
it('follows contributor IDs and restores the full graph', () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-10T12:00:00Z'))
  const { rerender } = render(<ContextualActivityChart collectionId="collection" repoId="repo" selectedContributorIds={['alice']} />)
  expect(screen.queryByLabelText('Student activity')).not.toBeInTheDocument()
  expect(screen.getByText('Alice — commits per day')).toBeInTheDocument()
  expect(screen.getByText(/Peer comparison unavailable/)).toBeInTheDocument()
  rerender(<ContextualActivityChart collectionId="collection" repoId="repo" selectedContributorIds={[]} />)
  expect(screen.getByText('All students — commits per day')).toBeInTheDocument()
  rerender(<ContextualActivityChart collectionId="collection" repoId="repo" selectedContributorIds={['alice', 'bob']} />)
  expect(screen.getByText('All students — commits per day')).toBeInTheDocument()
})
