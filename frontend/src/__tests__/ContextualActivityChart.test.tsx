import { render, screen, within } from '@testing-library/react'
import { vi, it, expect, afterEach } from 'vitest'
import type { ReactNode } from 'react'
import { ContextualActivityChart } from '@/components/ContextualActivityChart'
import { ACTIVITY_LEGEND, MARKER_RING } from '@/lib/activityContext'
vi.mock('@/hooks/useContextualActivity', () => ({ useContextualActivity: () => ({ data: { repositories: [{ id: 'repo', name: 'Repo', available: true, activity: [{ date: '2026-09-01', count: 1 }], students: [{ id: 'alice', name: 'Alice', activity: [{ date: '2026-09-01', count: 1 }] }] }] }, isLoading: false }) }))
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
  // The controls share the title's row and are pushed right by that row's
  // justify-between, rather than by a justify-end on their own container as
  // they were when they sat on a line of their own.
  expect(
    screen.getByLabelText('Activity range').closest('[data-testid="activity-header-row"]')
  ).toHaveClass('justify-between')
  expect(screen.queryByLabelText('Student activity')).not.toBeInTheDocument()
  expect(screen.getByText('Alice — commits per day')).toBeInTheDocument()
  // Context strings used to be listed in <details> panels under the graph. Those
  // are gone; the legend names the marker colours and the full text moved to the
  // tooltip. It is a fixed key, so all four entries show regardless of what this
  // fixture happens to trigger.
  const legend = screen.getByRole('list', { name: 'Marker legend' })
  expect(within(legend).getByText('Unusual Burst')).toBeInTheDocument()
  expect(within(legend).getByText('Quiet Period')).toBeInTheDocument()
  expect(within(legend).getByText('Deadline Burst')).toBeInTheDocument()
  expect(within(legend).getByText('Good Commit History')).toBeInTheDocument()
  rerender(<ContextualActivityChart collectionId="collection" repoId="repo" selectedContributorIds={[]} />)
  expect(screen.getByText('All students — commits per day')).toBeInTheDocument()
  rerender(<ContextualActivityChart collectionId="collection" repoId="repo" selectedContributorIds={['alice', 'bob']} />)
  expect(screen.getByText('All students — commits per day')).toBeInTheDocument()
})
it('draws a smoothed curve while keeping the contextual markers', () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-10T12:00:00Z'))
  render(<ContextualActivityChart collectionId="collection" repoId="repo" />)
  expect(areaProps[0]?.type).toBe('monotone')
  // Against the legend's own palette rather than a literal hex, so a colour
  // change reads as a colour change and not as a broken chart.
  expect(
    referenceDotProps.some(p => ACTIVITY_LEGEND.some(e => e.color === p.fill)),
  ).toBe(true)
  // Colour is never the only channel. Each marker wears the ring that keeps
  // it legible over the area fill, and the legend beside the chart carries
  // the text labels — which is why that legend is not optional.
  expect(
    referenceDotProps.filter(p => p.r).every(p => p.stroke === MARKER_RING),
  ).toBe(true)
})
