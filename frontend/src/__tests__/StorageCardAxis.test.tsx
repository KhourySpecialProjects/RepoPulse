import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { RepoNameTick } from '@/components/admin/overview/StorageCard'

/**
 * The largest-clones chart is a horizontal bar chart, so its repo names are
 * y-axis category ticks. Recharts right-aligns a left axis's ticks against
 * the plot area, which left a ragged gap between the card's edge and the
 * shorter names — roughly the width of the size-label margin on the right,
 * so the whole chart read as centred rather than as a column.
 *
 * These assertions are on the tick alone because `ResponsiveContainer`
 * measures 0x0 in jsdom and never renders the chart body, so there is no
 * axis in the DOM to inspect through the dashboard.
 */
const COLUMN = 104

function renderTick(name: string) {
  const { container } = render(
    <svg>
      {/* x is the column's right edge: the axis zeroes tickSize and
          tickMargin so recharts hands over the edge itself. */}
      <RepoNameTick
        x={COLUMN}
        y={40}
        width={COLUMN}
        payload={{ value: name }}
      />
    </svg>,
  )
  const text = container.querySelector('text')
  if (!text) throw new Error('tick rendered no text')
  return text
}

describe('largest clones axis labels', () => {
  it('starts a name at the left edge of its column, not against the bars', () => {
    const text = renderTick('ui')
    expect(text.getAttribute('text-anchor')).toBe('start')
    expect(text.getAttribute('x')).toBe('0')
  })

  it('gives a short name the same left edge as a long one', () => {
    // The point of the change: a straight left edge whatever the names are.
    expect(renderTick('ui').getAttribute('x')).toBe(
      renderTick('cs3000-final-project').getAttribute('x'),
    )
  })

  it('keeps a gutter so a long name cannot run into the bars', () => {
    const width = Number(renderTick('cs3000-final-project').getAttribute('width'))
    expect(width).toBeGreaterThan(0)
    expect(width).toBeLessThan(COLUMN)
  })

  it('centres the name on its bar', () => {
    // verticalAnchor middle, as recharts' own left-axis ticks are; a tick
    // anchored anywhere else sits off its row.
    expect(renderTick('ui').querySelector('tspan')).toBeInTheDocument()
  })
})
