import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CommitTypeBadge } from '@/components/CommitTypeBadge'

describe('CommitTypeBadge', () => {
  it('labels a substantive commit', () => {
    render(<CommitTypeBadge type="substantive" />)
    expect(screen.getByText('Substantive')).toBeInTheDocument()
  })

  it('labels a logistical commit', () => {
    render(<CommitTypeBadge type="logistical" />)
    expect(screen.getByText('Logistical')).toBeInTheDocument()
  })

  it('renders an unclassified commit as a dash, never as a real verdict', () => {
    // The whole point of the backend returning null: an unclassified commit
    // must not be mistakable for one the model actually judged.
    render(<CommitTypeBadge type={null} />)
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.queryByText('Substantive')).not.toBeInTheDocument()
    expect(screen.queryByText('Logistical')).not.toBeInTheDocument()
  })

  it('explains the dash on hover', () => {
    render(<CommitTypeBadge type={null} />)
    expect(screen.getByText('—')).toHaveAttribute('title', 'Not classified yet')
  })

  it('is static markup, not a button, unless given an onClick', () => {
    render(<CommitTypeBadge type="substantive" />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('becomes a filter toggle when given an onClick', () => {
    const onClick = vi.fn()
    render(<CommitTypeBadge type="substantive" onClick={onClick} />)
    fireEvent.click(screen.getByRole('button', { name: 'Substantive' }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('marks the badge as pressed when its filter is active', () => {
    render(<CommitTypeBadge type="logistical" onClick={() => {}} selected />)
    expect(screen.getByRole('button', { name: 'Logistical' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
  })
})
