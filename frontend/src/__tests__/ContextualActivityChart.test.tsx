import { render, screen, fireEvent } from '@testing-library/react'
import { vi, it, expect, afterEach } from 'vitest'
import { ContextualActivityChart } from '@/components/ContextualActivityChart'
vi.mock('@/hooks/useContextualActivity', () => ({ useContextualActivity: () => ({ data: { repositories: [{ id: 'repo', name: 'Repo', available: true, activity: [{ date: '2026-09-01', count: 1 }], students: [{ id: 'alice', name: 'Alice', activity: [{ date: '2026-09-01', count: 1 }] }] }] }, isLoading: false }) }))
afterEach(() => vi.useRealTimers())
it('selects graph students independently and restores all students', () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-10T12:00:00Z'))
  render(<ContextualActivityChart collectionId="collection" repoId="repo" />)
  fireEvent.change(screen.getByLabelText('Student activity'), { target: { value: 'alice' } })
  expect(screen.getByText('Alice — commits per day')).toBeInTheDocument()
  expect(screen.getByText(/Peer comparison unavailable/)).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('Student activity'), { target: { value: 'all' } })
  expect(screen.getByText('All students — commits per day')).toBeInTheDocument()
})
