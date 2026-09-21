import { useNavigate } from 'react-router-dom'
import { HardDriveDownload } from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Text,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { ChartCard, CrosshairTooltip, Meter } from '@/components/charts'
import { CHROME, MARKS, SERIES, TICK } from '@/lib/chartTheme'
import { formatBytes, formatBytesUnbroken } from '@/lib/formatBytes'
import {
  useAdminRepoStorage,
  useRecalculateAdminStorage,
} from '@/hooks/useAdminStats'
import type { AdminStorageSummary } from '@/types'

/**
 * Everything about disk, in one card.
 *
 * Capacity and the largest clones were two cards answering halves of one
 * question — how much room is left, and what is using it. Split across the
 * grid they read as unrelated, and each carried its own header and padding
 * for no benefit. Together they are the storage story top to bottom: the
 * volume, what the database thinks is on it, and the repos responsible.
 *
 * An unmounted root reads as "not mounted", never as 0% used. Zero bytes used
 * looks like a healthy empty volume, which is the opposite of the truth.
 *
 * The chart plots only measured clones. A null `size_bytes` means never
 * measured, which is not zero, and a zero-length bar would assert a
 * measurement nobody took — so those are counted in a footnote instead.
 *
 * The cap is sized to the row rather than chosen. Cards in the row share the
 * height of the tallest, which is repos-needing-attention at roughly 540px
 * once it lists five faulted repos. This card's fixed parts — meter, totals,
 * heading, footnote and padding — come to about 294px, leaving ~217px, and at
 * 20px per row plus a 32px axis band that is ten.
 *
 * Recompute it if the row's tallest card changes. On a healthy instance the
 * attention panel collapses to a single line and sync health becomes the
 * tallest, which leaves room for about four rows rather than ten; the chart
 * simply ends early in that case, since the card is never shorter than its
 * own content.
 *
 * Recalculate is the one mutation on this dashboard, and it is not an
 * exception to its reporting-only rule: it re-measures what is already on
 * disk and changes nothing about the clones themselves. It lives here because
 * this is the only card whose figures can be stale — sizes are as of
 * `newest_measurement`, not live — and it is the answer to that staleness.
 * Syncing a repo measures it too, so the figures stay current on their own;
 * the button is for measuring without waiting for a sync, and for repos not
 * synced since size measurement landed.
 */
const TOP_REPOS = 10

/**
 * The repo-name column, and the gap it keeps between a name and the bars.
 *
 * The gutter replaces the tick line and margin recharts would otherwise put
 * there — those are zeroed on the axis so a tick's `x` is the column's right
 * edge exactly, with no offsets to unwind.
 */
const NAME_COLUMN = 104
const NAME_GUTTER = 8

interface TickProps {
  x?: number
  y?: number
  width?: number
  payload?: { value?: string | number }
}

/**
 * A repo name anchored to the left edge of its column.
 *
 * Recharts right-aligns a left axis's ticks against the plot area, so short
 * names floated inward and left a ragged gap at the card's edge — about the
 * width of the size-label margin on the right, which made the chart read as
 * centred rather than as a column starting at the left. Anchoring at
 * `x - width` gives every name the same left edge whatever its length.
 *
 * The wrap width stops a gutter short of the bars, so a long name breaks
 * rather than colliding with the mark it labels.
 */
export function RepoNameTick({ x = 0, y = 0, width = NAME_COLUMN, payload }: TickProps) {
  return (
    <Text
      x={x - width}
      y={y}
      width={width - NAME_GUTTER}
      textAnchor="start"
      verticalAnchor="middle"
      style={TICK}
    >
      {String(payload?.value ?? '')}
    </Text>
  )
}

function formatWhen(iso: string | null): string {
  if (!iso) return 'never'
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? 'unknown' : date.toLocaleString()
}

interface Props {
  storage?: AdminStorageSummary
  isLoading: boolean
  isError: boolean
  onRetry: () => void
}

export function StorageCard({ storage, isLoading, isError, onRetry }: Props) {
  const navigate = useNavigate()
  const { data } = useAdminRepoStorage({ limit: TOP_REPOS, sort: 'size_desc' })
  const recalculate = useRecalculateAdminStorage()

  const measured = (data?.items ?? []).filter(
    (item) => item.size_bytes !== null && item.size_bytes > 0,
  )
  const unmeasured = storage?.clones.unmeasured_repos ?? 0

  return (
    <ChartCard
      title="Storage"
      description="Git repo clone volume."
      asOf={
        storage
          ? `Sizes as of ${formatWhen(storage.clones.newest_measurement)} — not live.`
          : undefined
      }
      action={
        // The endpoint walks every clone synchronously, so it is disabled
        // while in flight rather than left clickable — a second press would
        // start a second full walk of the same disk.
        <button
          type="button"
          onClick={() => recalculate.mutate(undefined)}
          disabled={recalculate.isPending}
          className="rounded border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
        >
          {recalculate.isPending ? 'Measuring…' : 'Recalculate'}
        </button>
      }
      isLoading={isLoading}
      isError={isError}
      onRetry={onRetry}
      testId="storage-card"
      table={
        measured.length > 0
          ? {
              caption: 'Largest clones by size on disk',
              columns: ['Repo', 'Collection', 'Size'],
              rows: measured.map((item) => [
                item.name,
                item.collection_name,
                formatBytes(item.size_bytes ?? 0),
              ]),
            }
          : undefined
      }
    >
      {storage && !storage.disk.exists ? (
        <p
          data-testid="capacity-missing"
          className="flex items-start gap-2 text-sm"
        >
          <HardDriveDownload
            aria-hidden="true"
            className="mt-0.5 h-4 w-4 shrink-0"
            style={{ color: '#d03b3b' }}
          />
          <span>
            <strong>{storage.repo_root_dir}</strong> is not mounted. Clones and
            size measurements will fail.
          </span>
        </p>
      ) : storage ? (
        <>
          <Meter
            testId="capacity-meter"
            percent={storage.disk.percent_used}
            label="Disk used"
            detail={`${formatBytes(storage.disk.free_bytes)} free of ${formatBytes(
              storage.disk.total_bytes,
            )}`}
          />
          <dl className="mt-3 grid grid-cols-2 gap-3 text-xs">
            <div>
              <dt className="text-muted-foreground">Clones</dt>
              <dd
                data-testid="capacity-clones"
                className="font-semibold tabular-nums"
              >
                {formatBytes(storage.clones.total_bytes)}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Database</dt>
              <dd
                data-testid="capacity-database"
                className="font-semibold tabular-nums"
              >
                {formatBytes(storage.database_bytes)}
              </dd>
            </div>
          </dl>

          <h4 className="mb-1.5 mt-3 border-t border-border pt-3 text-xs font-medium text-muted-foreground">
            Largest clones · top {TOP_REPOS}
          </h4>
          {measured.length === 0 ? (
            <p className="py-2 text-xs text-muted-foreground">
              No clone sizes measured yet. Press Recalculate to measure them.
            </p>
          ) : (
            <div
              // Sized from the row count so bars keep a constant thickness
              // instead of stretching, plus the x-axis band.
              style={{ height: `${measured.length * 20 + 32}px` }}
              data-testid="largest-clones-chart"
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={measured}
                  layout="vertical"
                  margin={{ top: 0, right: 52, bottom: 0, left: 0 }}
                  barCategoryGap="28%"
                >
                  <CartesianGrid
                    horizontal={false}
                    stroke={CHROME.grid}
                    strokeDasharray="0"
                  />
                  <XAxis
                    type="number"
                    tick={TICK}
                    axisLine={{ stroke: CHROME.axis }}
                    tickLine={false}
                    tickFormatter={(value: number) => formatBytes(value)}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    tick={<RepoNameTick />}
                    axisLine={false}
                    tickLine={false}
                    // Zeroed so the tick's x is the column's right edge and
                    // RepoNameTick owns the gutter instead of recharts.
                    tickSize={0}
                    tickMargin={0}
                    width={NAME_COLUMN}
                    interval={0}
                  />
                  <Tooltip
                    cursor={{ fill: CHROME.grid, fillOpacity: 0.4 }}
                    content={
                      <CrosshairTooltip
                        valueFormatter={(value) => formatBytes(value)}
                      />
                    }
                  />
                  <Bar
                    dataKey="size_bytes"
                    name="Size on disk"
                    fill={SERIES[0]}
                    maxBarSize={MARKS.barSize}
                    radius={[0, MARKS.barRadius, MARKS.barRadius, 0]}
                    onClick={(entry: {
                      id?: string
                      payload?: { id?: string }
                    }) => {
                      const id = entry?.id ?? entry?.payload?.id
                      if (id) navigate(`/repos/${id}`)
                    }}
                    className="cursor-pointer"
                  >
                    {/* Outside the bar end, so a label never overflows or is
                        clipped by a short bar. Unbroken because recharts
                        hands the bar's own width down as a wrap width even
                        out here, which would break "12.4 MB" after the space
                        on the short bars only. */}
                    <LabelList
                      dataKey="size_bytes"
                      position="right"
                      formatter={(value: number) => formatBytesUnbroken(value)}
                      style={{ fontSize: 11, fill: CHROME.label }}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {unmeasured > 0 && (
            <p
              data-testid="largest-clones-unmeasured"
              className="mt-1.5 text-xs text-muted-foreground"
            >
              {unmeasured} never measured, so excluded.
            </p>
          )}
        </>
      ) : null}
    </ChartCard>
  )
}
