import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { TypedMarkdown } from '@/components/TypedMarkdown'

const SUMMARY = 'The team committed steadily across the sprint and kept messages descriptive.'

afterEach(() => {
  vi.useRealTimers()
})

describe('TypedMarkdown', () => {
  it('renders the whole summary immediately when not animating', () => {
    render(<TypedMarkdown content={SUMMARY} animate={false} />)
    expect(screen.getByText(SUMMARY)).toBeInTheDocument()
  })

  it('reveals progressively while animating, then settles on the full text', () => {
    vi.useFakeTimers()
    const { container } = render(<TypedMarkdown content={SUMMARY} animate />)

    // Nothing has been typed on the first frame.
    expect(container.textContent).not.toContain(SUMMARY)

    act(() => {
      vi.advanceTimersByTime(200)
    })
    const partial = container.textContent ?? ''
    expect(partial.length).toBeGreaterThan(0)
    expect(partial).not.toContain(SUMMARY)

    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(container.textContent).toContain(SUMMARY)
  })

  it('calls onDone once the reveal finishes', () => {
    vi.useFakeTimers()
    const onDone = vi.fn()
    render(<TypedMarkdown content={SUMMARY} animate onDone={onDone} />)

    expect(onDone).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('skips the animation when the viewer prefers reduced motion', () => {
    const original = window.matchMedia
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia
    try {
      render(<TypedMarkdown content={SUMMARY} animate />)
      expect(screen.getByText(SUMMARY)).toBeInTheDocument()
    } finally {
      window.matchMedia = original
    }
  })
})
