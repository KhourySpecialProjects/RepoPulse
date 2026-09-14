import { render, screen, within } from '@testing-library/react'
import { vi, it, expect, afterEach } from 'vitest'
import type { ReactNode } from 'react'
import { ContextualActivityChart } from '@/components/ContextualActivityChart'
// Two students: the single-selection assertions below only mean anything if
// selecting one of them is distinguishable from selecting all of them.
vi.mock('@/hooks/useContextualActivity', () => ({ useContextualActivity: () => ({ data: { repositories: [{ id: 'repo', name: 'Repo', available: true, activity: [{ date: '2026-09-01', count: 1 }], students: [{ id: 'bob', name: 'Bob', activity: [] }, { id: 'alice', name: 'Alice', activity: [{ date: '2026-09-01', count: 1 }] }] }] }, isLoading: false }) }))
// Recharts needs a measurable container, which jsdom cannot provide, so stub the
// pieces we assert on and let the rest render as inert markers.
const areaProps: Record<string, unknown>[] = []
const referenceDotProps: Record<string, unknown>[] = []
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AreaChart: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Area: (props: Record<string, unknown>) => { areaProps.push(props); return null },
  ReferenceDot: (props: Record<string, unknown>) => { referenceDotProps.push(props); return null },
  CartesianGrid: () => null,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}))
afterEach(() => { vi.useRealTimers(); areaProps.length = 0; referenceDotProps.length = 0 })
// NOTE: a merge left a dangling `it('allows selecting a student and exposes
// explanations without hovering', () => {` here with no body and no closing
// brace, which made this file a syntax error and took `tsc` and the whole
// Vitest run down with it. The opener is removed so the file parses; the test
// it named still needs writing.
vi.mock('@/hooks/useContextualActivity', () => ({ useContextualActivity: () => ({ data: { repositories: [{ id: 'repo', name: 'Repo', available: true, activity: [{ date: '2026-09-01', count: 1 }], students: [{ id: 'bob', name: 'Bob', activity: [] }, { id: 'alice', name: 'Alice', activity: [{ date: '2026-09-01', count: 1 }] }] }] }, isLoading: false }) }))
afterEach(() => vi.useRealTimers())
it('follows contributor IDs and restores the full graph', () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-10T12:00:00Z'))
  const { rerender } = render(<ContextualActivityChart collectionId="collection" repoId="repo" selectedContributorIds={['alice']} />)
  expect(screen.getByLabelText('Activity range').parentElement).toHaveClass('justify-end')
  expect(screen.queryByLabelText('Student activity')).not.toBeInTheDocument()
  expect(screen.getByText('Alice — commits per day')).toBeInTheDocument()
  expect(screen.getByText(/Peer comparison unavailable/)).toBeInTheDocument()
  rerender(<ContextualActivityChart collectionId="collection" repoId="repo" selectedContributorIds={[]} />)
  expect(screen.getByText('All students — commits per day')).toBeInTheDocument()
  rerender(<ContextualActivityChart collectionId="collection" repoId="repo" selectedContributorIds={['alice', 'bob']} />)
  expect(screen.getByText('All students — commits per day')).toBeInTheDocument()
})
// The controls used to sit on their own line under the title, which left a
// band of empty card to the right of "Commit Activity" and pushed the graph
// down. They belong on the title's line.
it('puts the title and the controls on one row', () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-10T12:00:00Z'))
  render(
    <ContextualActivityChart
      collectionId="collection"
      repoId="repo"
      actions={<button type="button">Check In</button>}
    />
  )
  const controls = screen.getByLabelText('Activity range').parentElement as HTMLElement
  const titleRow = controls.parentElement as HTMLElement
  expect(titleRow.className).toContain('justify-between')
  expect(within(titleRow).getByText('Commit Activity')).toBeInTheDocument()
  // The caller's own buttons ride along, rather than needing their own line.
  expect(within(controls).getByRole('button', { name: 'Check In' })).toBeInTheDocument()
})
it('draws a smoothed curve while keeping the contextual markers', () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-10T12:00:00Z'))
  render(<ContextualActivityChart collectionId="collection" repoId="repo" />)
  expect(areaProps[0]?.type).toBe('monotone')
  expect(referenceDotProps.some(p => p.fill === '#d97706')).toBe(true)
})
