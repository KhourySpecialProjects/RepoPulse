import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import type * as Recharts from 'recharts'
import { CollectionCommitActivityChart } from '@/components/CollectionCommitActivityChart'
import * as api from '@/services/api'

/**
 * The peak and the last day carry count labels drawn above their points.
 * At the top of the plot or its right edge, recharts' default 5px margin left
 * them partly outside the SVG, where they were clipped.
 *
 * jsdom cannot measure a ResponsiveContainer, so it is swapped for one that
 * hands the chart a fixed size; everything else is the real chart.
 */
// Hoisted with the mock below, which runs before module-level consts exist.
const { WIDTH, HEIGHT } = vi.hoisted(() => ({ WIDTH: 600, HEIGHT: 192 }))
// The labels' style in the component: 13px semibold digits, centred on x.
const FONT_SIZE = 13
const DIGIT_WIDTH = 0.6 * FONT_SIZE

vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof Recharts>('recharts')
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactNode }) =>
      isValidElement(children)
        ? cloneElement(children as ReactElement<{ width: number; height: number }>, { width: WIDTH, height: HEIGHT })
        : null,
  }
})

vi.mock('@/services/api', async () => {
  const actual = await vi.importActual<typeof api>('@/services/api')
  return { ...actual, getCollectionCommitActivity: vi.fn() }
})

function recentDate(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10)
}

describe('CollectionCommitActivityChart point labels', () => {
  it('keeps a peak on the last day inside the chart at the top and right edges', async () => {
    // The worst case: the highest point is also the rightmost one.
    vi.mocked(api.getCollectionCommitActivity).mockResolvedValue({
      activity: [
        { date: recentDate(6), count: 4 },
        { date: recentDate(3), count: 9 },
        { date: recentDate(0), count: 120 },
      ],
    })
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <CollectionCommitActivityChart collectionId="col-1" />
      </QueryClientProvider>
    )

    // Labels appear once the area's entrance animation finishes. Unlabelled
    // points render empty text, so find the one carrying the count.
    const label = await waitFor(
      () => {
        const texts = screen.getByTestId('commit-activity-chart').querySelectorAll('.recharts-label-list text')
        const text = Array.from(texts).find(t => t.textContent === '120')
        if (!text) throw new Error('no point label yet')
        return text
      },
      { timeout: 4000 }
    )

    const x = Number(label.getAttribute('x'))
    const y = Number(label.getAttribute('y'))
    const halfWidth = (label.textContent!.length * DIGIT_WIDTH) / 2
    // y is the text's bottom edge (recharts anchors top labels at "end").
    expect(y - FONT_SIZE).toBeGreaterThanOrEqual(0)
    expect(x + halfWidth).toBeLessThanOrEqual(WIDTH)
  })
})
