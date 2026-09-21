import { useMemo, type ReactNode } from 'react'
import { AlertTriangle, ArrowRight } from 'lucide-react'
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
import { PHOENIX_URL } from '@/lib/phoenixUrl'
import type { AdminLlmUsage } from '@/types'

/**
 * Load on the LLM integration, over time.
 *
 * A "call" here is one request to the provider. That is worth stating because
 * it was not always true: volume used to be counted as rows in `summaries`
 * and `commit_classifications`, so classifying 222 commits drew a spike of
 * 222 against the six batched requests it actually made, and the height of
 * the chart tracked repo size rather than load.
 *
 * Two plotted series, so a legend is mandatory — identity must never rest on
 * colour matching alone — and the slots are taken in order from the validated
 * categorical palette rather than picked to look nice together.
 *
 * Two, though the API reports three kinds. chartTheme documents a two-slot
 * categorical palette and the reason it stops there: a generated third hue is
 * indistinguishable from an existing one under CVD simulation, so the tail
 * gets folded rather than coloured. Folding the two commit kinds together is
 * not an arbitrary pairing — commit classification and commit quality are the
 * same batched request to the same service, differing only in which dimension
 * of the answer the caller keeps. The table view has no colour budget and
 * breaks all three out.
 *
 * Deliberately not cost, and the note below says so on the card rather than
 * only in a docstring. Cost needs rates an administrator enters, so it is
 * reported next to them on AI Settings; a spend figure derived from call
 * volume alone would read as measured and be wrong by a multiple. Phoenix has
 * the real per-span usage.
 *
 * The backend emits only days that have rows, so the series is zero-filled
 * here across the whole window. Joining the points as given would draw a line
 * straight through a quiet week and hide the gap.
 */

/** The kinds the API reports, each its own column in the table view. */
const FEATURES = [
  { key: 'summary', label: 'Summaries' },
  { key: 'commit_classification', label: 'Commit classifications' },
  { key: 'commit_quality', label: 'Commit quality' },
] as const

/** Plotted series. Two slots, assigned in order and never cycled. */
const KINDS = [
  {
    key: 'summary',
    label: 'Summaries',
    color: SERIES[0],
    features: ['summary'],
  },
  {
    key: 'commit_analysis',
    label: 'Commit analysis',
    color: SERIES[1],
    features: ['commit_classification', 'commit_quality'],
  },
] as const

interface Props {
  /** The window toggle, which scopes this card and only this card. */
  action?: ReactNode
  llm?: AdminLlmUsage
  isLoading: boolean
  isError: boolean
  isPlaceholder: boolean
  onRetry: () => void
  /**
   * Opens another admin tab. "How much load" invites "from whom, and against
   * what limit", and that answer is one tab away rather than on this card.
   */
  onNavigate?: (tab: string) => void
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
  onNavigate,
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
      const counts = Object.fromEntries(
        FEATURES.map((feature) => [feature.key, bucket[feature.key] ?? 0]),
      ) as Record<(typeof FEATURES)[number]['key'], number>

      return {
        day,
        ...counts,
        // The folded series the chart plots, alongside the per-feature counts
        // the table reads.
        commit_analysis: counts.commit_classification + counts.commit_quality,
      }
    })
  }, [llm, windowDays])

  const hasCalls = series.some((point) =>
    FEATURES.some((feature) => point[feature.key] > 0),
  )

  return (
    <ChartCard
      title="LLM call volume"
      description={`Provider requests per day, last ${windowDays} days. Not cost.`}
      isLoading={isLoading}
      isError={isError}
      onRetry={onRetry}
      isPlaceholder={isPlaceholder}
      isEmpty={!hasCalls}
      emptyMessage="No LLM calls in this window."
      testId="llm-volume"
      action={action}
      table={{
        caption: 'Provider requests per day by kind',
        columns: ['Day', ...FEATURES.map((feature) => feature.label)],
        rows: series.map((point) => [
          point.day,
          ...FEATURES.map((feature) => point[feature.key]),
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
            provider {llm.total_calls === 1 ? 'request' : 'requests'} ·{' '}
            {llm.models_in_use.length}{' '}
            {llm.models_in_use.length === 1 ? 'model' : 'models'}. Tokens and
            cost are on the AI Settings tab;{' '}
            <a
              href={PHOENIX_URL}
              target="_blank"
              rel="noreferrer"
              className="underline hover:text-foreground"
            >
              Phoenix
            </a>{' '}
            has per-call traces.
          </p>

          {/* A button rather than the prose pointer this replaces: the tab is
              reachable in one click instead of being named and left to the
              reader to find. Rendered only when the host can navigate, so the
              card stays usable anywhere it is mounted on its own. */}
          {onNavigate && (
            <button
              type="button"
              onClick={() => onNavigate('ai')}
              data-testid="llm-volume-ai-settings"
              className="mt-2 inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Per-user usage and limits
              <ArrowRight aria-hidden="true" className="h-3 w-3" />
            </button>
          )}
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
