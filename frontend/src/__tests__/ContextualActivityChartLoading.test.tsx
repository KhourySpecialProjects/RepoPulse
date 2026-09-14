/**
 * The graph's loading state.
 *
 * Separate file because `vi.mock` factories are fixed per module per file, and
 * ContextualActivityChart.test.tsx pins `isLoading: false` for all of its cases.
 */
import { act, render, screen } from '@testing-library/react'
import { vi, it, expect, describe, afterEach } from 'vitest'
import type { ReactNode } from 'react'
import { ContextualActivityChart } from '@/components/ContextualActivityChart'

vi.mock('@/hooks/useContextualActivity', () => ({
  useContextualActivity: () => ({ data: undefined, isLoading: true, isError: false, refetch: () => {} }),
}))

// Recharts needs a measurable container jsdom cannot provide. Nothing here
// should reach it while loading — that is part of what these tests check.
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AreaChart: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Area: () => null,
  ReferenceDot: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}))

function renderChart() {
  return render(<ContextualActivityChart collectionId="collection" repoId="repo" />)
}

// The progress tests install fake timers; leaving them installed would hang the
// ones after them, which wait on a real interval.
afterEach(() => vi.useRealTimers())

describe('ContextualActivityChart — loading state', () => {
  it('shows a progress indicator while the activity data loads', () => {
    renderChart()
    expect(screen.getByRole('status', { name: 'Loading commit activity graph' })).toBeInTheDocument()
  })

  it('spins a circle rather than only printing text', () => {
    const { container } = renderChart()
    expect(container.querySelector('.animate-spin')).not.toBeNull()
  })

  it('stops the spinner for users who asked for reduced motion', () => {
    const { container } = renderChart()
    expect(container.querySelector('.animate-spin')).toHaveClass('motion-reduce:animate-none')
  })

  it('shows a progress bar that starts empty', () => {
    renderChart()
    const bar = screen.getByRole('progressbar', { name: 'Commit activity loading progress' })
    expect(bar).toHaveAttribute('aria-valuenow', '0')
  })

  it('advances the bar as the wait goes on', () => {
    vi.useFakeTimers()
    renderChart()
    const bar = screen.getByRole('progressbar', { name: 'Commit activity loading progress' })

    act(() => { vi.advanceTimersByTime(600) })
    const early = Number(bar.getAttribute('aria-valuenow'))
    expect(early).toBeGreaterThan(0)

    act(() => { vi.advanceTimersByTime(2000) })
    expect(Number(bar.getAttribute('aria-valuenow'))).toBeGreaterThan(early)
  })

  it('decelerates instead of advancing at a constant rate', () => {
    vi.useFakeTimers()
    renderChart()
    const bar = screen.getByRole('progressbar', { name: 'Commit activity loading progress' })
    const read = () => Number(bar.getAttribute('aria-valuenow'))

    act(() => { vi.advanceTimersByTime(900) })
    const firstLeg = read()
    act(() => { vi.advanceTimersByTime(900) })
    const secondLeg = read() - firstLeg

    // A linear bar would cover equal ground in equal time and reach 100% long
    // before the data does.
    expect(secondLeg).toBeLessThan(firstLeg)
  })

  it('never claims to be finished while the data is still loading', () => {
    vi.useFakeTimers()
    renderChart()
    const bar = screen.getByRole('progressbar', { name: 'Commit activity loading progress' })

    act(() => { vi.advanceTimersByTime(60_000) })

    expect(Number(bar.getAttribute('aria-valuenow'))).toBeLessThan(100)
  })

  it('clips the fill to its track', () => {
    renderChart()
    expect(screen.getByRole('progressbar', { name: 'Commit activity loading progress' })).toHaveClass('overflow-hidden')
  })

  it('reserves the chart height so the card does not jump when data lands', () => {
    renderChart()
    // Same h-56 the rendered graph occupies.
    expect(screen.getByRole('status', { name: 'Loading commit activity graph' })).toHaveClass('h-56')
  })

  it('does not render the graph or its caption while loading', () => {
    renderChart()
    expect(screen.queryByLabelText('Commit activity graph')).not.toBeInTheDocument()
    expect(screen.queryByText(/commits per day/)).not.toBeInTheDocument()
  })

  it('still shows the card title and range control', () => {
    renderChart()
    expect(screen.getByText('Commit Activity')).toBeInTheDocument()
    expect(screen.getByLabelText('Activity range')).toBeInTheDocument()
  })
})
