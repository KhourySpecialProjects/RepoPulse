import { AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { ChartCard, StackedShareBar } from '@/components/charts'
import { CHROME, MARKS, ordinalStep, STATUS, TICK } from '@/lib/chartTheme'
import type { AdminPipeline, AdminSyncFreshness } from '@/types'

/**
 * Is ingestion working, and when did it last work?
 *
 * Two views of one question. The share bar is the live state; the histogram
 * is how long ago each repo was last pulled successfully.
 *
 * Everything about syncing, in one card: what state each repo is in, how
 * current the fleet's data is, when each repo last pulled, and why the
 * failures failed. These were two cards asking halves of one question.
 *
 * Note the split source. The fresh/stale/never counts come from
 * /admin/overview while the state bar, histogram and error groups come from
 * /admin/pipeline, so the freshness block renders even when the pipeline
 * query fails — which is when an operator most wants to know how stale
 * things are.
 *
 * The histogram is over `last_synced_at` — when *we* last fetched — and not
 * `last_commit_at`, which is when a student last pushed. Only the first is an
 * operations metric, and conflating them is how an admin dashboard quietly
 * turns into a gradebook.
 *
 * Buckets are ordered, so they take an ordinal ramp: swapping "under a day"
 * with "over 30 days" would change the meaning, and the reader should see
 * that order in the colour. `never` is not a longer duration — it is off the
 * scale entirely — so it gets the de-emphasis grey rather than the ramp's
 * dark end.
 */
interface Props {
  pipeline?: AdminPipeline
  /** From /admin/overview, not the pipeline — see the note above. */
  sync: AdminSyncFreshness
  isLoading: boolean
  isError: boolean
  onRetry: () => void
}

export function SyncHealthCard({
  pipeline,
  sync,
  isLoading,
  isError,
  onRetry,
}: Props) {
  const state = pipeline?.sync_state
  const errors = pipeline?.sync_errors ?? []
  const buckets = pipeline?.sync_age ?? []
  const rampBuckets = buckets.filter((bucket) => bucket.key !== 'never')
  // Buckets always come back zero-filled, so a non-empty list is not the
  // same as having anything to plot.
  const hasAgeData = buckets.some((bucket) => bucket.repos > 0)

  const chartData = buckets.map((bucket, index) => ({
    ...bucket,
    fill:
      bucket.key === 'never'
        ? CHROME.deemphasis
        : ordinalStep(index, rampBuckets.length),
  }))

  return (
    <ChartCard
      title="Sync health"
      description={`State, freshness and failures. Stale means no sync in ${sync.stale_after_days} days.`}
      testId="sync-health"
      table={{
        caption: 'Repos by time since last successful sync',
        columns: ['Age', 'Repos'],
        rows: buckets.map((bucket) => [bucket.label, bucket.repos]),
      }}
    >
      <div className="mb-4">
        <div data-testid="sync-summary" className="grid grid-cols-3 gap-3">
          <div>
            <div className="text-lg font-semibold tabular-nums">{sync.fresh}</div>
            <div className="text-xs text-muted-foreground">fresh</div>
          </div>
          <div>
            <div
              className={`text-lg font-semibold tabular-nums ${
                sync.stale > 0 ? 'text-amber-700' : ''
              }`}
            >
              {sync.stale}
            </div>
            <div className="text-xs text-muted-foreground">stale</div>
          </div>
          <div>
            <div
              className={`text-lg font-semibold tabular-nums ${
                sync.never_synced > 0 ? 'text-amber-700' : ''
              }`}
            >
              {sync.never_synced}
            </div>
            <div className="text-xs text-muted-foreground">never synced</div>
          </div>
        </div>
        {sync.never_synced + sync.stale > 0 && (
          <p data-testid="stale-note" className="mt-2 text-xs text-muted-foreground">
            Repos that have not synced are scored <em>unknown</em>, not
            unhealthy — a rising unknown count is an operations problem, not a
            student one.
          </p>
        )}
      </div>

      {isLoading ? (
        <div className="h-32 animate-pulse rounded-lg bg-muted" />
      ) : isError ? (
        <div role="alert" className="flex items-center gap-3 text-sm">
          <span className="text-muted-foreground">
            Could not load sync health.
          </span>
          <button
            type="button"
            onClick={onRetry}
            className="rounded border border-border px-2 py-1 text-xs hover:bg-muted"
          >
            Retry
          </button>
        </div>
      ) : (
        <>
      {state && (
        <div className="mb-4 border-t border-border pt-3">
          <StackedShareBar
            barTestId="sync-state-bar"
            testIdPrefix="sync-state"
            emptyMessage="No repositories yet."
            segments={[
              {
                key: 'idle',
                label: 'idle',
                value: state.idle,
                color: STATUS.good,
                icon: CheckCircle2,
              },
              {
                key: 'syncing',
                label: 'syncing',
                value: state.syncing,
                color: '#2a78d6',
                icon: RefreshCw,
              },
              {
                key: 'failed',
                label: 'failed',
                value: state.failed,
                color: STATUS.critical,
                icon: AlertTriangle,
              },
            ]}
          />
        </div>
      )}

      {hasAgeData && (
        <>
          <h4 className="mb-1.5 border-t border-border pt-3 text-xs font-medium text-muted-foreground">
            Time since last successful sync
          </h4>
          {/* Height covers the plot AND the x-axis band, so the card never
              grows a nested scrollbar. */}
          <div className="h-32" data-testid="sync-age-chart">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={chartData}
                margin={{ top: 4, right: 8, bottom: 0, left: -20 }}
              >
                <CartesianGrid
                  vertical={false}
                  stroke={CHROME.grid}
                  // Solid hairline. Dashing reads as "projection" or
                  // "threshold" when it is only a grid.
                  strokeDasharray="0"
                />
                <XAxis
                  dataKey="label"
                  tick={{ ...TICK, fontSize: 9 }}
                  axisLine={{ stroke: CHROME.axis }}
                  tickLine={false}
                  interval={0}
                  angle={-35}
                  textAnchor="end"
                  height={46}
                />
                <YAxis
                  tick={TICK}
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={false}
                />
                <Tooltip
                  cursor={{ fill: CHROME.grid, fillOpacity: 0.4 }}
                  content={({ active, payload }) =>
                    active && payload?.length ? (
                      <div className="rounded-md border border-border bg-card px-2.5 py-1.5 text-xs shadow-md">
                        <span className="font-semibold tabular-nums">
                          {payload[0].payload.repos}
                        </span>{' '}
                        <span className="text-muted-foreground">
                          {payload[0].payload.repos === 1 ? 'repo' : 'repos'} ·{' '}
                          {payload[0].payload.label}
                        </span>
                      </div>
                    ) : null
                  }
                />
                <Bar
                  dataKey="repos"
                  maxBarSize={MARKS.barSize}
                  radius={[MARKS.barRadius, MARKS.barRadius, 0, 0]}
                >
                  {chartData.map((entry) => (
                    <Cell key={entry.key} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}

      {errors.length > 0 && (
        <div className="mt-3 border-t border-border pt-3">
          <h4 className="mb-2 text-xs font-medium text-muted-foreground">
            Failures, grouped by cause
          </h4>
          <ul data-testid="sync-error-groups" className="flex flex-col gap-1.5">
            {errors.map((group) => (
              <li
                key={group.error}
                className="flex items-start justify-between gap-3 text-xs"
              >
                <span className="min-w-0 flex-1">
                  <span className="font-mono text-foreground">{group.error}</span>
                  <span className="text-muted-foreground">
                    {' '}
                    · e.g. {group.example_repo_name}
                  </span>
                </span>
                <span className="shrink-0 font-semibold tabular-nums">
                  {group.repos} {group.repos === 1 ? 'repo' : 'repos'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
        </>
      )}
    </ChartCard>
  )
}
