import type { TooltipProps } from 'recharts'

import { CHROME } from '@/lib/chartTheme'

/**
 * One readout listing every series at the hovered x.
 *
 * Three decisions worth keeping:
 *
 *  - Every series appears, not just the one under the pointer. The reader
 *    aims at a date, never at a 2px line, so landing on a specific stroke
 *    must not be the price of reading its value.
 *  - The value leads and the series name follows. This inverts the legend's
 *    hierarchy on purpose: here the reader already knows which series they
 *    care about and wants the number.
 *  - Series are keyed with a short stroke rather than a filled box. At
 *    tooltip density a box is data-weight ink doing a label's job.
 *
 * Names arrive from API responses, so they are inserted as text children -
 * React escapes them - never as markup.
 */
interface Props extends TooltipProps<number, string> {
  labelFormatter?: (label: string | number) => string
  valueFormatter?: (value: number) => string
}

export function CrosshairTooltip({
  active,
  payload,
  label,
  labelFormatter,
  valueFormatter,
}: Props) {
  if (!active || !payload?.length) return null

  return (
    <div className="rounded-md border border-border bg-card px-2.5 py-2 text-xs shadow-md">
      <div className="mb-1 font-medium text-muted-foreground">
        {labelFormatter ? labelFormatter(label as string | number) : String(label)}
      </div>
      {payload.map((entry) => (
        <div
          key={String(entry.dataKey)}
          className="flex items-center gap-2 py-0.5"
        >
          <span
            aria-hidden="true"
            className="inline-block h-0.5 w-3 rounded-full"
            style={{ backgroundColor: entry.color ?? CHROME.deemphasis }}
          />
          <span className="font-semibold tabular-nums text-foreground">
            {valueFormatter
              ? valueFormatter(Number(entry.value ?? 0))
              : Number(entry.value ?? 0).toLocaleString()}
          </span>
          <span className="text-muted-foreground">{entry.name}</span>
        </div>
      ))}
    </div>
  )
}
