import { cn } from '@/lib/utils'

/**
 * The red pending-count pill on the notification bell.
 *
 * Centring note: `items-center` centres the *line box*, not the digits. With
 * `leading-none` that line box (1em) is shorter than the font's content box,
 * and the resulting negative half-leading drops the baseline below a naive
 * centre — measured in Chromium, the glyph sat with 7.31px of red above it and
 * 5.0px below inside a 20px circle. `TRANSLATE` lifts it back.
 */

const SIZES = {
  sm: 'h-4 min-w-[16px] px-1 text-[9px]',
  md: 'h-5 min-w-[20px] px-1.5 text-[11px]',
} as const

/**
 * Measured, not guessed: sweeping this against rendered pixels put the ink
 * 1.16px low at 0, and 0.06px off centre at 0.1em. In `em` so the one constant
 * serves both type sizes.
 */
const TRANSLATE = '-translate-y-[0.1em]'

export function UnreadBadge({
  count,
  size = 'md',
  className,
}: {
  count: number
  size?: keyof typeof SIZES
  className?: string
}) {
  if (count <= 0) return null

  return (
    <span
      data-testid="unread-badge"
      className={cn(
        'inline-flex items-center justify-center rounded-full bg-red-500 font-bold tabular-nums text-white',
        SIZES[size],
        // After the size: tailwind-merge groups `leading-*` with font-size
        // (a Tailwind `text-*` can set both), so a later `text-[11px]` would
        // otherwise strip this and hand the digit back its inherited leading.
        'leading-none',
        className
      )}
    >
      <span className={cn('block', TRANSLATE)}>{count > 99 ? '99+' : count}</span>
    </span>
  )
}
