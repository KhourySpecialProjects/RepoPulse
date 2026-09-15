import { capacitySeverity, STATUS } from '@/lib/chartTheme'

/**
 * One ratio against a limit.
 *
 * A meter, not a chart: a single fraction of a known capacity is a figure,
 * and a one-bar bar chart with an axis would add chrome without adding
 * information.
 *
 * The unfilled track is a tint of the fill's own colour rather than a neutral
 * grey, so the state reads across the whole bar instead of only the filled
 * part. Severity thresholds are shared through `capacitySeverity`, so the
 * same disk cannot look healthy on one page and critical on another.
 *
 * The percentage is always rendered as text beside the bar. The fill colour
 * is a second encoding of a value the reader can already see, never the only
 * one - and at 75% the warning step sits below 3:1 on white, so the label is
 * what actually carries it.
 */
interface Props {
  /** 0-100. */
  percent: number
  label: string
  /** e.g. "300 GB free of 500 GB". */
  detail?: string
  testId?: string
}

const FILL: Record<string, string> = {
  ok: '#2a78d6',
  warning: STATUS.warning,
  critical: STATUS.critical,
}

export function Meter({ percent, label, detail, testId }: Props) {
  const clamped = Math.min(Math.max(percent, 0), 100)
  const severity = capacitySeverity(clamped)
  const fill = FILL[severity] ?? FILL.ok

  return (
    <div data-testid={testId}>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className="text-sm font-semibold tabular-nums">
          {Math.round(clamped)}%
        </span>
      </div>
      <div
        role="meter"
        aria-valuenow={Math.round(clamped)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
        className="h-2 w-full overflow-hidden rounded-full"
        // A tint of the fill, so the track belongs to the same ramp.
        style={{ backgroundColor: `${fill}24` }}
      >
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{ width: `${clamped}%`, backgroundColor: fill }}
        />
      </div>
      {detail && (
        <p className="mt-1.5 text-xs text-muted-foreground">{detail}</p>
      )}
    </div>
  )
}
