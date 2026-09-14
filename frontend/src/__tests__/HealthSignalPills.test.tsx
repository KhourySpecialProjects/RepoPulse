import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { HealthSignalPills } from '@/components/HealthSignalPills'
import type { HealthScore } from '@/types'

/** Signals are scored 0–2, so 2 is healthy, 1 is middling and 0 is at risk. */
function health(overrides: Partial<HealthScore> = {}): HealthScore {
  return {
    commit_frequency: 2,
    recency: 1,
    distribution: 0,
    branch_activity: 2,
    commit_message_quality: 1,
    participation: 0,
    composite: 0.5,
    status: 'yellow',
    ...overrides,
  }
}

function pillFor(label: string): HTMLElement {
  const el = screen.getByText(label).closest('li')
  if (!el) throw new Error(`no pill for ${label}`)
  return el
}

describe('HealthSignalPills', () => {
  it('renders one pill per signal', () => {
    render(<HealthSignalPills health={health()} />)
    const labels = [
      'Frequency',
      'Recency',
      'Distribution',
      'Branches',
      'Msg Quality',
      'Participation',
    ]
    labels.forEach(label => expect(screen.getByText(label)).toBeInTheDocument())
    expect(screen.getAllByRole('listitem')).toHaveLength(labels.length)
  })

  it('tints each pill by its own score rather than the composite', () => {
    render(<HealthSignalPills health={health()} />)
    expect(pillFor('Frequency').className).toContain('bg-emerald-50')
    expect(pillFor('Recency').className).toContain('bg-amber-50')
    expect(pillFor('Distribution').className).toContain('bg-red-50')
  })

  it('names the tier in text, so colour is never the only signal', () => {
    render(<HealthSignalPills health={health()} />)
    expect(pillFor('Frequency')).toHaveTextContent('Healthy')
    expect(pillFor('Recency')).toHaveTextContent('Needs attention')
    expect(pillFor('Distribution')).toHaveTextContent('At risk')
  })

  it('explains what each signal measures in a title', () => {
    render(<HealthSignalPills health={health()} />)
    expect(pillFor('Frequency')).toHaveAttribute('title', expect.stringContaining('commits/week'))
    expect(pillFor('Participation')).toHaveAttribute('title', expect.stringContaining('expected'))
  })

  // participation is the one optional signal; a missing value is a real state
  // for a repo with no expected head count, not a reason to drop the pill.
  it('treats a null participation score as at risk rather than omitting it', () => {
    render(<HealthSignalPills health={health({ participation: null })} />)
    expect(pillFor('Participation').className).toContain('bg-red-50')
  })

  it('renders nothing when there is no health score yet', () => {
    const { container } = render(<HealthSignalPills health={null} />)
    expect(container).toBeEmptyDOMElement()
  })
})
