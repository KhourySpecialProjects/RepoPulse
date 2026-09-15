import type { LucideIcon } from 'lucide-react'

import { CHROME } from '@/lib/chartTheme'

/**
 * Part-to-whole, as one horizontal bar.
 *
 * A stacked bar rather than a donut: a donut is only legible at a glance for
 * a handful of segments and is hopeless for comparing close values, and a
 * two-slice pie is a stat tile that went wrong.
 *
 * Segments are separated by a 2px gap in the *surface* colour, not by a
 * stroke around each segment. A border adds data-weight ink that is not data;
 * a gap lets neighbouring colours read as distinct without it.
 *
 * Every segment appears in the legend with its count even when that count is
 * zero. A legend that hides "failed" whenever nothing is failing makes a
 * healthy instance and a broken query look identical - and the reader cannot
 * tell which they are looking at.
 *
 * Where a segment carries state rather than identity, pass its `icon`: the
 * status steps for warning and serious sit below 3:1 on a white surface, so
 * the icon and the label are what actually carry the meaning.
 */
export interface ShareSegment {
  key: string
  label: string
  value: number
  color: string
  icon?: LucideIcon
}

interface Props {
  segments: ShareSegment[]
  /** Per-segment `data-testid`, as `${testIdPrefix}-${segment.key}`. */
  testIdPrefix?: string
  barTestId?: string
  emptyMessage?: string
}

export function StackedShareBar({
  segments,
  testIdPrefix,
  barTestId,
  emptyMessage = 'Nothing to show yet.',
}: Props) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0)

  if (total === 0) {
    return <p className="text-sm text-muted-foreground">{emptyMessage}</p>
  }

  const present = segments.filter((segment) => segment.value > 0)

  return (
    <>
      <div
        data-testid={barTestId}
        className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted"
        // The gap between fills is surface-coloured, so it reads as air
        // rather than as a third colour.
        style={{ gap: `${2}px`, backgroundColor: CHROME.grid }}
      >
        {present.map((segment) => (
          <div
            key={segment.key}
            className="h-full first:rounded-l-full last:rounded-r-full"
            style={{
              width: `${(segment.value / total) * 100}%`,
              backgroundColor: segment.color,
            }}
          />
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
        {segments.map((segment) => {
          const Icon = segment.icon
          return (
            <span
              key={segment.key}
              data-testid={testIdPrefix ? `${testIdPrefix}-${segment.key}` : undefined}
              className="inline-flex items-center gap-1.5 text-sm"
            >
              {Icon ? (
                <Icon
                  aria-hidden="true"
                  className="h-3.5 w-3.5 shrink-0"
                  style={{ color: segment.color }}
                />
              ) : (
                <span
                  aria-hidden="true"
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: segment.color }}
                />
              )}
              <span className="font-semibold tabular-nums">
                {segment.value.toLocaleString()}
              </span>
              {/* Text wears a text token, never the series colour: the
                  lighter palette steps are illegible as type. */}
              <span className="text-muted-foreground">{segment.label}</span>
            </span>
          )
        })}
      </div>
    </>
  )
}
