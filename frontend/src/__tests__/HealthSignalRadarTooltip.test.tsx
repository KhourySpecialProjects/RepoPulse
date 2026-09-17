import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SignalTooltip } from '@/components/dashboard/HealthSignalRadar'

/**
 * The radar's hover label is its own component so it can be asserted directly.
 *
 * It was previously an inline `content` render prop sitting next to a
 * `formatter` prop — and Recharts ignores `formatter` whenever `content` is
 * set, so the formatter was dead code. Converting the scale to 0–100 updated
 * the dead one and left the live label reading "60/2".
 */
describe('SignalTooltip', () => {
  it('labels the hovered signal out of 100', () => {
    render(<SignalTooltip active payload={[{ value: 60, payload: { label: 'Recency' } }]} />)

    expect(screen.getByText('Recency: 60/100')).toBeInTheDocument()
  })

  it('never shows the backend 0-2 grade as the denominator', () => {
    render(<SignalTooltip active payload={[{ value: 17, payload: { label: 'Distribution' } }]} />)

    expect(screen.queryByText(/\/\s*2$/)).not.toBeInTheDocument()
    expect(screen.getByText('Distribution: 17/100')).toBeInTheDocument()
  })

  it('renders nothing while nothing is hovered', () => {
    const { container } = render(<SignalTooltip active={false} payload={[]} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when Recharts passes no point', () => {
    const { container } = render(<SignalTooltip active />)

    expect(container).toBeEmptyDOMElement()
  })
})
