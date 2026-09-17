/**
 * The Commit Activity graph honours the page's Branch, Type and Date filters.
 *
 * Branch and Type narrow the series itself. Date does not — it picks a single
 * day, and a one-point area chart says nothing — so it highlights that day in
 * place instead, leaving the surrounding weeks visible for comparison.
 *
 * The contextual markers stay on under a filter, computed against the filtered
 * series. That keeps the graph informative, but it changes what a marker means:
 * a quiet period becomes "no commits *matching this filter*", and the peer
 * numbers a quiet period quotes are each peer's total activity, since the
 * activity endpoint has no type or branch dimension to narrow them by. A
 * caption states both, so the same marker cannot silently mean two things.
 */
import { render, screen, within } from '@testing-library/react'
import { vi, it, expect, afterEach, describe } from 'vitest'
import type { ReactNode } from 'react'
import { ContextualActivityChart } from '@/components/ContextualActivityChart'

vi.mock('@/hooks/useContextualActivity', () => ({
  useContextualActivity: () => ({
    data: {
      repositories: [
        {
          id: 'repo',
          name: 'Repo',
          available: true,
          activity: [
            { date: '2026-09-01', count: 4 },
            { date: '2026-09-02', count: 0 },
            { date: '2026-09-03', count: 0 },
            { date: '2026-09-04', count: 0 },
            { date: '2026-09-05', count: 3 },
          ],
          students: [
            { id: 'alice', name: 'Alice', activity: [{ date: '2026-09-01', count: 4 }] },
          ],
        },
        // A peer with earlier history, so the quiet-period comparison has
        // something eligible to compare against.
        {
          id: 'peer',
          name: 'Peer',
          available: true,
          activity: [
            { date: '2026-08-20', count: 2 },
            { date: '2026-09-03', count: 5 },
          ],
          students: [],
        },
      ],
    },
    isLoading: false,
  }),
}))

const areaProps: Record<string, unknown>[] = []
const referenceDotProps: Record<string, unknown>[] = []
const referenceLineProps: Record<string, unknown>[] = []

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AreaChart: ({ children, data }: { children: ReactNode; data: unknown }) => {
    areaProps.push({ data })
    return <div>{children}</div>
  },
  Area: () => null,
  ReferenceDot: (props: Record<string, unknown>) => {
    referenceDotProps.push(props)
    return null
  },
  ReferenceLine: (props: Record<string, unknown>) => {
    referenceLineProps.push(props)
    return null
  },
  CartesianGrid: () => null,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}))

afterEach(() => {
  vi.useRealTimers()
  areaProps.length = 0
  referenceDotProps.length = 0
  referenceLineProps.length = 0
})

function renderChart(props: Record<string, unknown> = {}) {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-05T12:00:00Z'))
  return render(
    <ContextualActivityChart collectionId="collection" repoId="repo" {...props} />
  )
}

/** The series recharts was actually handed, as date→count. */
function plottedCounts(): Record<string, number> {
  const data = (areaProps[areaProps.length - 1]?.data ?? []) as {
    date: string
    count: number
  }[]
  return Object.fromEntries(data.map((p) => [p.date, p.count]))
}

describe('series filtering', () => {
  it('plots the repo history when nothing is filtered', () => {
    renderChart()

    const counts = plottedCounts()
    expect(counts['2026-09-01']).toBe(4)
    expect(counts['2026-09-05']).toBe(3)
  })

  it('plots the supplied series instead when a filter narrows it', () => {
    renderChart({
      activityOverride: [
        { date: '2026-09-01', count: 1 },
        { date: '2026-09-05', count: 2 },
      ],
      filterLabel: 'logistical',
    })

    const counts = plottedCounts()
    expect(counts['2026-09-01']).toBe(1)
    expect(counts['2026-09-05']).toBe(2)
  })

  it('names the active filter so the smaller numbers are explained', () => {
    renderChart({
      activityOverride: [{ date: '2026-09-01', count: 1 }],
      filterLabel: 'logistical on main',
    })

    expect(screen.getByText(/logistical on main/)).toBeInTheDocument()
  })

  it('fills unfiltered days with zero rather than dropping them', () => {
    // A gap must read as "no matching commits that day", not as a shorter
    // chart — the x-axis has to stay comparable to the unfiltered view.
    renderChart({ activityOverride: [{ date: '2026-09-05', count: 2 }] })

    expect(plottedCounts()['2026-09-03']).toBe(0)
  })

  it('shows an empty-but-real chart when a filter matches nothing', () => {
    renderChart({ activityOverride: [], filterLabel: 'logistical' })

    // Not the "No commit history available" empty state: the repo has
    // history, this filter just excludes all of it, and those are different
    // things to tell someone.
    expect(
      screen.queryByText(/No commit history available/i)
    ).not.toBeInTheDocument()
    expect(screen.getByText(/no commits match/i)).toBeInTheDocument()
  })
})

describe('contextual markers under a filter', () => {
  it('marks quiet periods and bursts on the unfiltered series', () => {
    renderChart()

    expect(referenceDotProps.some((p) => p.r)).toBe(true)
  })

  it('keeps marking the series while a filter is active', () => {
    renderChart({
      activityOverride: [
        { date: '2026-09-01', count: 1 },
        { date: '2026-09-05', count: 1 },
      ],
      filterLabel: 'logistical',
    })

    // Sep 2–4 have no matching commits, which is a quiet stretch in the
    // filtered series and gets its marker like any other.
    expect(referenceDotProps.filter((p) => p.r).length).toBeGreaterThan(0)
  })

  it('says the markers describe the filtered slice, not the repository', () => {
    renderChart({
      activityOverride: [{ date: '2026-09-01', count: 1 }],
      filterLabel: 'logistical',
    })

    // Without this the same marker means two different things depending on
    // whether a filter happens to be on — a gap in one commit type would
    // read as a student who stopped working.
    expect(
      screen.getByText(/a quiet period here means no commits/i)
    ).toBeInTheDocument()
  })

  it('warns that peer comparisons are against each peer’s total activity', () => {
    // The activity endpoint has no type or branch dimension, so the peers in
    // a quiet period's text cannot be filtered to match. Saying so is what
    // keeps "3 of 4 peers were active" from reading as like-for-like.
    renderChart({
      activityOverride: [{ date: '2026-09-01', count: 1 }],
      filterLabel: 'logistical',
    })

    expect(screen.getByText(/peer comparisons use each peer/i)).toBeInTheDocument()
  })

  it('adds no such caveat when nothing is filtered', () => {
    renderChart()

    expect(
      screen.queryByText(/a quiet period here means no commits/i)
    ).not.toBeInTheDocument()
  })

  it('keeps the legend visible as a key under a filter', () => {
    renderChart({
      activityOverride: [{ date: '2026-09-01', count: 1 }],
      filterLabel: 'logistical',
    })

    const legend = screen.getByRole('list', { name: 'Marker legend' })
    expect(within(legend).getByText('Quiet Period')).toBeInTheDocument()
  })
})

describe('highlighting a selected date', () => {
  it('draws no highlight when no date is selected', () => {
    renderChart()

    expect(referenceLineProps.length).toBe(0)
  })

  it('marks the selected day in place', () => {
    renderChart({ highlightDate: '2026-09-03' })

    expect(referenceLineProps.some((p) => p.x === '2026-09-03')).toBe(true)
  })

  it('keeps the surrounding days on the chart', () => {
    // The whole point of highlighting rather than filtering: the selected day
    // is only meaningful next to the days around it.
    renderChart({ highlightDate: '2026-09-03' })

    const counts = plottedCounts()
    expect(counts['2026-09-01']).toBe(4)
    expect(counts['2026-09-05']).toBe(3)
  })

  it('widens the window when the selected day predates the history shown', () => {
    // The repo's own history starts 2026-09-01, so without widening this day
    // is not on the chart at all and the highlight would point at nothing.
    renderChart({ highlightDate: '2026-08-22' })

    expect(plottedCounts()['2026-08-22']).toBeDefined()
    expect(referenceLineProps.some((p) => p.x === '2026-08-22')).toBe(true)
  })

  it('highlights a day inside a filtered series too', () => {
    renderChart({
      activityOverride: [{ date: '2026-09-03', count: 2 }],
      filterLabel: 'logistical',
      highlightDate: '2026-09-03',
    })

    expect(referenceLineProps.some((p) => p.x === '2026-09-03')).toBe(true)
    expect(plottedCounts()['2026-09-03']).toBe(2)
  })
})
