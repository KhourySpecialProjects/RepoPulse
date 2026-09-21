import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

/** Where the bar parks itself. The request finishes it, by unmounting this. */
const CEILING = 90
const TICK_MS = 180
/** Keeps the bar from stalling visibly once the decelerating step goes tiny. */
const MIN_STEP = 0.4

/**
 * A progress bar for waits that report no real percentage.
 *
 * It advances in decelerating steps — fast at first, slower as it approaches
 * CEILING — and stops short of 100. Stopping short is deliberate: a bar that
 * hit 100% while the user was still waiting would be a visible lie, and one
 * that advanced linearly would routinely finish long before the data. The
 * request ends the bar by unmounting it.
 *
 * Use where there is genuinely nothing to measure. When you can count real
 * work — resolved queries, processed files — drive a plain bar off that
 * instead, the way the repo page's top-of-page loader counts its five queries.
 */
export function TrickleProgress({ label, className }: { label: string; className?: string }) {
  const [value, setValue] = useState(0)

  useEffect(() => {
    const id = setInterval(() => {
      setValue(v => (v >= CEILING ? v : Math.min(CEILING, v + Math.max(MIN_STEP, (CEILING - v) / 8))))
    }, TICK_MS)
    return () => clearInterval(id)
  }, [])

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value)}
      className={cn('h-1 w-40 overflow-hidden rounded-full bg-muted', className)}
    >
      {/* Inline width because the value is continuous — the same reason the
          repo page's loading bar sets it this way. */}
      <div
        data-testid="trickle-progress-fill"
        className="h-full rounded-full bg-brand-500 transition-[width] duration-200 ease-out"
        style={{ width: `${value}%` }}
      />
    </div>
  )
}
