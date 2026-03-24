import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { HealthBadge } from '@/components/HealthBadge'

describe('HealthBadge', () => {
  it('renders Healthy for green status', () => {
    render(<HealthBadge status="green" />)
    expect(screen.getByText('Healthy')).toBeInTheDocument()
  })

  it('renders At Risk for yellow status', () => {
    render(<HealthBadge status="yellow" />)
    expect(screen.getByText('At Risk')).toBeInTheDocument()
  })

  it('renders Critical for red status', () => {
    render(<HealthBadge status="red" />)
    expect(screen.getByText('Critical')).toBeInTheDocument()
  })

  it('renders Unknown for unknown status', () => {
    render(<HealthBadge status="unknown" />)
    expect(screen.getByText('Unknown')).toBeInTheDocument()
  })

  it('applies custom className', () => {
    const { container } = render(<HealthBadge status="green" className="test-class" />)
    expect(container.firstChild).toHaveClass('test-class')
  })
})
