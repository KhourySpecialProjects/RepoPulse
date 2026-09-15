/**
 * The "nothing unusual" case.
 *
 * Its own file because `vi.mock` factories are fixed per module per file, and
 * ContextualActivityChart.test.tsx's fixture always goes quiet — so it always
 * earns a marker and never reaches the ✓ branch. Steady daily activity across
 * the whole window is what produces no markers at all.
 */
import { render, screen, within } from '@testing-library/react'
import { vi, it, expect, describe, afterEach } from 'vitest'
import type { ReactNode } from 'react'
import { ContextualActivityChart } from '@/components/ContextualActivityChart'

// Ten commits every day from the 1st to the 10th: no gap to call quiet, and no
// day that clears 3x the preceding week's average.
const steady = Array.from({ length: 10 }, (_, i) => ({
  date: `2026-09-${String(i + 1).padStart(2, '0')}`,
  count: 10,
}))

vi.mock('@/hooks/useContextualActivity', () => ({
  useContextualActivity: () => ({
    data: {
      repositories: [
        { id: 'repo', name: 'Repo', available: true, activity: steady, students: [] },
      ],
    },
    isLoading: false,
    isError: false,
    refetch: () => {},
  }),
}))

const referenceDotProps: Record<string, unknown>[] = []
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AreaChart: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Area: () => null,
  ReferenceDot: (props: Record<string, unknown>) => { referenceDotProps.push(props); return null },
  CartesianGrid: () => null,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}))

afterEach(() => { vi.useRealTimers(); referenceDotProps.length = 0 })

function renderChart() {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-10T12:00:00Z'))
  return render(<ContextualActivityChart collectionId="collection" repoId="repo" />)
}

describe('ContextualActivityChart — nothing unusual', () => {
  it('lists every contextualization as a fixed key, loudest first', () => {
    renderChart()
    const legend = screen.getByRole('list', { name: 'Marker legend' })
    expect(within(legend).getAllByRole('listitem').map(li => li.textContent)).toEqual([
      'Deadline Burst', 'Unusual Burst', 'Quiet Period', 'Good Commit History',
    ])
  })

  it('draws no markers when steady activity earns none', () => {
    renderChart()
    expect(referenceDotProps.filter(p => p.r === 6)).toHaveLength(0)
  })

  it('draws the check mark in the colour its legend swatch advertises', () => {
    renderChart()
    const check = referenceDotProps.find(p => (p.label as { value?: string })?.value === '✓')
    expect(check).toBeDefined()
    expect((check?.label as { fill?: string }).fill).toBe('#15803d')
  })
})
