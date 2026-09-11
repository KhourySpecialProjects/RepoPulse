import { render, screen, fireEvent } from '@testing-library/react'
import { vi, it, expect, afterEach } from 'vitest'
import type { ReactNode } from 'react'
import { ContextualActivityChart } from '@/components/ContextualActivityChart'
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
it('allows selecting a student and exposes explanations without hovering', () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-10T12:00:00Z'))
  render(<ContextualActivityChart collectionId="collection" repoId="repo" />)
  fireEvent.change(screen.getByLabelText('Student activity'), { target: { value: 'alice' } })
  expect(screen.getByText('Alice — commits per day')).toBeInTheDocument()
  expect(screen.getByText(/Peer comparison unavailable/)).toBeInTheDocument()
})
it('draws a smoothed curve while keeping the contextual markers', () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-10T12:00:00Z'))
  render(<ContextualActivityChart collectionId="collection" repoId="repo" />)
  expect(areaProps[0]?.type).toBe('monotone')
  expect(referenceDotProps.some(p => p.fill === '#d97706')).toBe(true)
})
