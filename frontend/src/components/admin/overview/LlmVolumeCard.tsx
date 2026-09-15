import { useMemo, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { ChartCard, CrosshairTooltip } from '@/components/charts'
import { CHROME, MARKS, SERIES, STATUS, TICK } from '@/lib/chartTheme'
import type { AdminLlmUsage } from '@/types'

/**
 * Load on the LLM integration, over time.
 *
 * The first thing to render `AdminLlmUsage.daily`, which the API has been
 * returning since the endpoint shipped with nothing on the client reading it.
 *
 * Two series, so a legend is mandatory — identity must never rest on colour
 * matching alone — and the two slots are taken in order from the validated
 * categorical palette rather than picked to look nice together.
 *
 * Deliberately not cost, and the note below says so on the card rather than
 * only in a docstring. No token counts are persisted on either source table,
 * so any spend figure would be rows x assumed-tokens x assumed-price: a
 * number that reads as measured and is wrong by a multiple. Phoenix has the
 * real per-span usage.
 *
 * The backend emits only days that have rows, so the series is zero-filled
 * here across the whole window. Joining the points as given would draw a line
 * straight through a quiet week and hide the gap.
 */
const PHOENIX_URL = 'http://localhost:6006'

const KINDS = [
  { key: 'summary', label: 'Summaries', color: SERIES[0] },
  { key: 'commit_classification', label: 'Commit classifications', color: SERIES[1] },
] as const

interface Props {
  /** The window toggle, which scopes this card and only this card. */
  action?: ReactNode
  llm?: AdminLlmUsage
  isLoading: boolean
  isError: boolean
  isPlaceholder: boolean
  onRetry: () => void
}

function formatDay(value: string | number): string {
  return new Date(`${value}T12:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })
}

export function LlmVolumeCard({
  action,
  llm,
  isLoading,
  isError,
  isPlaceholder,
  onRetry,
}: Props) {
  const windowDays = llm?.window_days ?? 30

  const series = useMemo(() => {
    if (!llm) return []
    const byDay = new Map<string, Record<string, number>>()
    for (const point of llm.daily) {
      const bucket = byDay.get(point.day) ?? {}
      bucket[point.kind] = (bucket[point.kind] ?? 0) + point.calls
      byDay.set(point.day, bucket)
    }

    const today = new Date()
    return Array.from({ length: windowDays }, (_, offset) => {
      const date = new Date(today)
      date.setUTCDate(date.getUTCDate() - (windowDays - 1 - offset))
      const day = date.toISOString().slice(0, 10)
      const bucket = byDay.get(day) ?? {}
      return {
        day,
        summary: bucket.summary ?? 0,
        commit_classification: bucket.commit_classification ?? 0,
      }
    })
  }, [llm, windowDays])

  const hasCalls = series.some(
    (point) => point.summary > 0 || point.commit_classification > 0,
  )

  return (
    <ChartCard
      title="LLM call volume"
      description={`Calls per day, last ${windowDays} days. Not cost.`}
      isLoading={isLoading}
      isError={isError}
      onRetry={onRetry}
      isPlaceholder={isPlaceholder}
      isEmpty={!hasCalls}
      emptyMessage="No LLM calls in this window."
      testId="llm-volume"
      action={action}
      table={{
        caption: 'LLM calls per day by kind',
        columns: ['Day', 'Summaries', 'Commit classifications'],
        rows: series.map((point) => [
          point.day,
          point.summary,
          point.commit_classification,
        ]),
      }}
    >
      <div className="h-40" data-testid="llm-volume-chart">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={series}
            margin={{ top: 4, right: 8, bottom: 0, left: -20 }}
          >
            <CartesianGrid
              vertical={false}
              stroke={CHROME.grid}
              strokeDasharray="0"
            />
            <XAxis
              dataKey="day"
              tick={TICK}
              axisLine={{ stroke: CHROME.axis }}
              tickLine={false}
              minTickGap={28}
              tickFormatter={formatDay}
            />
            <YAxis
              tick={TICK}
              axisLine={false}
              tickLine={false}
              allowDecimals={false}
            />
            <Tooltip
              content={
                <CrosshairTooltip labelFormatter={formatDay} />
              }
              cursor={{ stroke: CHROME.axis, strokeWidth: 1 }}
            />
            <Legend
              verticalAlign="top"
              align="left"
              height={28}
              iconType="plainline"
              iconSize={10}
              formatter={(value) => (
                <span className="text-xs text-muted-foreground">{value}</span>
              )}
            />
            {KINDS.map((kind) => (
              <Area
                key={kind.key}
                type="monotone"
                dataKey={kind.key}
                name={kind.label}
                stackId="calls"
                stroke={kind.color}
                strokeWidth={MARKS.strokeWidth}
                fill={kind.color}
                fillOpacity={MARKS.areaOpacity}
                // A surface-coloured seam between stacked fills, rather than
                // a stroke drawn around each one.
                activeDot={{
                  r: MARKS.dotRadius,
                  stroke: CHROME.surface,
                  strokeWidth: MARKS.surfaceRing,
                }}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {llm && (
        <div className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">
          <p>
            <span className="font-semibold tabular-nums text-foreground">
              {llm.total_calls.toLocaleString()}
            </span>{' '}
            calls · {llm.models_in_use.length}{' '}
            {llm.models_in_use.length === 1 ? 'model' : 'models'} · no cost
            shown (tokens are not persisted;{' '}
            <a
              href={PHOENIX_URL}
              target="_blank"
              rel="noreferrer"
              className="underline hover:text-foreground"
            >
              Phoenix
            </a>{' '}
            has the real usage)
          </p>
          {llm.retired_models_in_use.length > 0 && (
            <p
              data-testid="llm-volume-retired"
              className="mt-1 flex items-start gap-1.5"
            >
              <AlertTriangle
                aria-hidden="true"
                className="mt-0.5 h-3 w-3 shrink-0"
                style={{ color: STATUS.warning }}
              />
              <span>
                Retired models still in use:{' '}
                {llm.retired_models_in_use.join(', ')}
              </span>
            </p>
          )}
        </div>
      )}
    </ChartCard>
  )
}
