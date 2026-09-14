import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useReducedMotion } from 'framer-motion'
import { ThinkingLabel } from '@/components/ThinkingLabel'

vi.mock('framer-motion', () => ({ useReducedMotion: vi.fn(() => false) }))

beforeEach(() => {
  vi.useFakeTimers()
  vi.mocked(useReducedMotion).mockReturnValue(false)
})
afterEach(() => vi.useRealTimers())

describe('ThinkingLabel', () => {
  it('erases the original label and types successive words with a pause between them', () => {
    const { container } = render(<ThinkingLabel />)
    expect(container.textContent).toBe('Generate Summary')
    act(() => { vi.advanceTimersByTime(400) })
    expect(container.textContent).toBe('Generate S')
    act(() => { vi.advanceTimersByTime(1400) })
    expect(container.textContent).toBe('Building…')
    act(() => { vi.advanceTimersByTime(1500) })
    expect(container.textContent).toBe('')
    act(() => { vi.advanceTimersByTime(800) })
    expect(container.textContent).toBe('Coding…')
  })

  it('stops all typing timers when generation ends and the label unmounts', () => {
    const { unmount } = render(<ThinkingLabel />)
    expect(vi.getTimerCount()).toBe(1)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('uses a static label without timers for reduced motion', () => {
    vi.mocked(useReducedMotion).mockReturnValue(true)
    const { container } = render(<ThinkingLabel />)
    expect(container.textContent).toBe('Generating…')
    expect(vi.getTimerCount()).toBe(0)
  })
})
