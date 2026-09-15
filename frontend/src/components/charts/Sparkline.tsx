import { Line, LineChart, ResponsiveContainer, Tooltip } from 'recharts'

import { CHROME, MARKS, SERIES } from '@/lib/chartTheme'

/**
 * A trend, at tile scale.
 *
 * No axes, no grid, no dots: at this size they are noise, and the tile's
 * value and delta already carry the magnitude. The line is the de-emphasis
 * grey with the final point in the accent, so the eye lands on "now" rather
 * than tracing the whole series.
 *
 * Extracted from RepoCard, which had this chart inline. A second copy would
 * have drifted the first time one of them changed.
 */
interface Props {
  values: number[]
  /** Appears in the hover readout, e.g. "commits". */
  unit?: string
  className?: string
  /** Falls back to the de-emphasis grey. */
  color?: string
}

export function Sparkline({
  values,
  unit = '',
  className = 'h-10',
  color = CHROME.deemphasis,
}: Props) {
  if (values.length === 0) return null

  const data = values.map((value, index) => ({ index, value }))
  const last = data[data.length - 1]

  return (
    <div className={className}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 2, right: 3, bottom: 2, left: 3 }}>
          <Line
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={MARKS.strokeWidth - 0.5}
            dot={false}
            isAnimationActive={false}
            // The current period in the accent; the run-up stays recessive.
            activeDot={{
              r: MARKS.dotRadius - 1,
              fill: SERIES[0],
              stroke: CHROME.surface,
              strokeWidth: MARKS.surfaceRing,
            }}
          />
          <Tooltip
            content={({ active, payload }) =>
              active && payload?.length ? (
                <div className="rounded border border-border bg-card px-2 py-1 text-xs shadow-sm">
                  <span className="font-semibold tabular-nums">
                    {Number(payload[0].value ?? 0).toLocaleString()}
                  </span>
                  {unit && <span className="text-muted-foreground"> {unit}</span>}
                </div>
              ) : null
            }
          />
        </LineChart>
      </ResponsiveContainer>
      <span className="sr-only">
        {`Latest ${last.value.toLocaleString()} ${unit}`.trim()}
      </span>
    </div>
  )
}
