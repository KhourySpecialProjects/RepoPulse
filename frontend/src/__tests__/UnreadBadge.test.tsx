/**
 * The count sat low in its 20px circle — 7.31px of red above the glyph, 5.0px
 * below, measured off rendered pixels in Chromium.
 *
 * `items-center` centres the line box, not the ink. Under `leading-none` the
 * line box is shorter than the font's content box, and the negative
 * half-leading that follows drops the baseline. Centring digits therefore
 * needs an explicit optical correction, and that correction has to live in one
 * place — the sidebar rendered this badge twice, collapsed and expanded, from
 * duplicated class strings.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { UnreadBadge } from '@/components/UnreadBadge'

describe('UnreadBadge', () => {
  it('shows the exact count up to 99', () => {
    render(<UnreadBadge count={99} />)
    expect(screen.getByTestId('unread-badge')).toHaveTextContent('99')
  })

  it('caps anything larger at 99+', () => {
    render(<UnreadBadge count={100} />)
    expect(screen.getByTestId('unread-badge')).toHaveTextContent('99+')
  })

  it('renders nothing when there is nothing pending', () => {
    render(<UnreadBadge count={0} />)
    expect(screen.queryByTestId('unread-badge')).not.toBeInTheDocument()
  })

  it('optically centres the digits inside the circle', () => {
    render(<UnreadBadge count={4} />)
    const badge = screen.getByTestId('unread-badge')

    // The circle centres its content...
    expect(badge.className).toContain('items-center')
    expect(badge.className).toContain('justify-center')
    expect(badge.className).toContain('rounded-full')

    // ...and the digits carry the descender correction. Transforms do not
    // apply to non-replaced inline elements, so it must be blockified.
    const digits = badge.querySelector('span')
    expect(digits).not.toBeNull()
    expect(digits!.className).toContain('block')
    expect(digits!.className).toMatch(/translate-y-\[[\d.]+em\]/)
  })

  it('scales the correction with the type size rather than hardcoding pixels', () => {
    const { container: small } = render(<UnreadBadge count={4} size="sm" />)
    const { container: medium } = render(<UnreadBadge count={4} size="md" />)

    const correction = (root: HTMLElement) =>
      root.querySelector('[data-testid="unread-badge"] span')!.className.match(
        /translate-y-\[([\d.]+)em\]/
      )![1]

    // Same em value at both sizes: em tracks font-size, so one constant
    // centres the 9px badge and the 11px one alike.
    expect(correction(small)).toBe(correction(medium))
  })
})
