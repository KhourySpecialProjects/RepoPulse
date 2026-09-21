import { ChartCard } from '@/components/charts'
import { CHROME, STATUS } from '@/lib/chartTheme'
import type { AdminCoverageGap, AdminPipeline } from '@/types'

/**
 * How much of the data a working pipeline would have filled is actually there.
 *
 * This is the operations reading of health data, and the only one this page
 * carries. A repo scored `unknown`, or holding no health score at all, means
 * the scoring pipeline did not run — that is an admin's problem. Whether the
 * repos that *were* scored came out green or red is an instructor's problem
 * and is deliberately absent.
 *
 * Each bar is drawn against its own denominator, which is not decoration: the
 * denominators genuinely differ. Orphan directories are counted against what
 * is on disk, because a directory with no database row is by definition not
 * one of the rows.
 *
 * Bars carry a single hue with the count beside them. Colouring each bar by
 * its own magnitude would spend the identity channel re-encoding the length
 * the reader can already see.
 */
interface Props {
  pipeline?: AdminPipeline
  isLoading: boolean
  isError: boolean
  onRetry: () => void
}

function tone(gap: AdminCoverageGap): string {
  if (gap.affected === 0) return CHROME.deemphasis
  // Drift is a real fault; a missing measurement is housekeeping.
  const serious = gap.key === 'missing_clone' || gap.key === 'orphan_directory'
  return serious ? STATUS.critical : '#2a78d6'
}

export function CoverageCard({
  pipeline,
  isLoading,
  isError,
  onRetry,
}: Props) {
  const gaps = pipeline?.coverage ?? []
  const clean = gaps.every((gap) => gap.affected === 0)

  return (
    <ChartCard
      title="Data coverage"
      description="What hasn't been measured yet, and where records don't match the disk."
      isLoading={isLoading}
      isError={isError}
      onRetry={onRetry}
      isEmpty={gaps.length === 0}
      emptyMessage="Nothing to measure yet."
      testId="coverage-card"
      table={{
        caption: 'Data coverage gaps',
        columns: ['Gap', 'Affected', 'Of'],
        rows: gaps.map((gap) => [gap.label, gap.affected, gap.total]),
      }}
    >
      {clean && (
        <p className="mb-2 text-xs text-muted-foreground">
          No gaps: every repo is scored and measured, and the database agrees
          with the disk.
        </p>
      )}
      {/* Laid out across rather than down: this card spans the full width
          below the row of four, and six stacked bars there would be a narrow
          ribbon of content beside a lot of nothing. Each gap keeps its own
          denominator — they genuinely differ, and orphan directories are
          counted against what is on disk rather than against repo rows. */}
      <ul className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-6">
        {gaps.map((gap) => {
          const share = gap.total > 0 ? (gap.affected / gap.total) * 100 : 0
          return (
            <li key={gap.key} data-testid={`coverage-${gap.key}`}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-lg font-semibold tabular-nums">
                  {gap.affected}
                </span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  / {gap.total}
                </span>
              </div>
              <div
                className="mt-1 h-1.5 w-full overflow-hidden rounded-full"
                style={{ backgroundColor: CHROME.grid }}
              >
                <div
                  className="h-full rounded-full transition-[width] duration-500"
                  style={{
                    width: `${Math.min(share, 100)}%`,
                    backgroundColor: tone(gap),
                  }}
                />
              </div>
              <p className="mt-1 text-xs leading-snug text-muted-foreground">
                {gap.label}
              </p>
            </li>
          )
        })}
      </ul>
    </ChartCard>
  )
}
