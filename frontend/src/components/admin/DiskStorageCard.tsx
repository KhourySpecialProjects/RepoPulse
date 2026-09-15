import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'

import {
  useAdminStorage,
  useRecalculateAdminStorage,
} from '@/hooks/useAdminStats'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui'
import { formatBytes } from '@/lib/formatBytes'
import type { AdminStorageSummary } from '@/types'

/**
 * Server-side storage: clones on disk, the database, and drift between them.
 *
 * Reporting only — no reclaim, archive or delete affordance. `orphan_directories`
 * is the accumulated cost of every repo ever removed, because repo removal
 * deletes database rows without touching git files on disk. Surfacing the
 * number is in scope; acting on it is not.
 *
 * Recalculate is the one mutation here, and it is not an exception to that
 * rule: it re-measures what is already on disk and changes nothing about the
 * clones themselves. Syncing a repo now measures it too, so these figures stay
 * current on their own; this button is for measuring without waiting for a
 * sync, and for the repos that have not been synced since the feature landed.
 *
 * Sizes are as of `size_computed_at`, not live, so staleness is displayed
 * rather than hidden.
 */

function formatWhen(iso: string | null): string {
  if (!iso) return 'never'
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? 'unknown' : date.toLocaleString()
}

function DiskPanel({ disk }: { disk: AdminStorageSummary['disk'] }) {
  if (!disk.exists) {
    return (
      <p data-testid="disk-missing" className="text-sm text-amber-700">
        <code className="font-mono">{disk.root}</code> is not mounted. Clone
        storage cannot be measured.
      </p>
    )
  }

  const percent = Math.min(100, Math.round(disk.percent_used))
  return (
    <div data-testid="disk-usage" className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm">
          {formatBytes(disk.free_bytes)} free of {formatBytes(disk.total_bytes)}
        </span>
        <span className="text-xs text-muted-foreground">{percent}% used</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full ${percent >= 90 ? 'bg-red-500' : percent >= 75 ? 'bg-amber-500' : 'bg-emerald-500'}`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  )
}

export function DiskStorageCard() {
  const { data, isLoading, isError, refetch } = useAdminStorage()
  const recalculate = useRecalculateAdminStorage()
  const [tablesOpen, setTablesOpen] = useState(false)

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Server storage</CardTitle>
        </CardHeader>
        <CardContent>
          <div data-testid="disk-loading" className="h-24 animate-pulse rounded bg-muted" />
        </CardContent>
      </Card>
    )
  }

  if (isError || !data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Server storage</CardTitle>
        </CardHeader>
        <CardContent>
          <div role="alert" className="flex items-center gap-3 text-sm">
            <span className="text-muted-foreground">
              Could not load storage figures.
            </span>
            <button
              type="button"
              onClick={() => refetch()}
              className="rounded border border-border px-2 py-1 text-xs hover:bg-muted"
            >
              Retry
            </button>
          </div>
        </CardContent>
      </Card>
    )
  }

  const { disk, clones, database_bytes, tables, drift, repo_root_dir } = data

  // Capped at ten: this is the "what is big" answer, and a full table list
  // belongs behind its own view rather than in a summary card. Named so the
  // toggle's count and the rows it reveals cannot drift apart.
  const visibleTables = tables.slice(0, 10)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Server storage</CardTitle>
        <CardDescription>
          Clones live under <code className="font-mono">{repo_root_dir}</code>,
          the real path from <code className="font-mono">REPO_ROOT_DIR</code>.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-5">
        <DiskPanel disk={disk} />

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <div>
            <div data-testid="clone-total" className="text-lg font-semibold">
              {formatBytes(clones.total_bytes)}
            </div>
            <div className="text-xs text-muted-foreground">
              clones ({formatBytes(clones.git_bytes)} in .git)
            </div>
          </div>
          <div>
            <div data-testid="database-total" className="text-lg font-semibold">
              {formatBytes(database_bytes)}
            </div>
            <div className="text-xs text-muted-foreground">database</div>
          </div>
          <div>
            <div data-testid="measured-repos" className="text-lg font-semibold">
              {clones.measured_repos}
            </div>
            <div className="text-xs text-muted-foreground">
              repos measured
              {clones.unmeasured_repos > 0 &&
                ` · ${clones.unmeasured_repos} never measured`}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p data-testid="measured-at" className="text-xs text-muted-foreground">
            Sizes as of {formatWhen(clones.newest_measurement)} — not live.
          </p>
          {/*
            Sits with the staleness line because it is the answer to it. The
            endpoint walks every clone synchronously, so it is disabled while
            in flight rather than left clickable — a second press would start a
            second full walk of the same disk.
          */}
          <button
            type="button"
            onClick={() => recalculate.mutate(undefined)}
            disabled={recalculate.isPending}
            className="rounded border border-border px-2 py-1 text-xs hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
          >
            {recalculate.isPending ? 'Measuring…' : 'Recalculate'}
          </button>
        </div>

        <div data-testid="drift" className="flex flex-col gap-1 text-xs">
          <span className={drift.orphan_directories.length > 0 ? 'text-amber-700' : 'text-muted-foreground'}>
            {drift.orphan_directories.length} clone
            {drift.orphan_directories.length === 1 ? '' : 's'} on disk with no
            database rows
            {drift.orphan_bytes !== null && ` (${formatBytes(drift.orphan_bytes)})`}
          </span>
          {/*
            "with a missing clone" described the mechanism, not the situation.
            This number counts repo rows whose files are not where the app
            expects them — which happens both to repos that were never
            downloaded (a clone that failed, or a seeded row that never had
            files) and to ones whose clone has since vanished. Those are
            different problems and only the second is alarming, so the wording
            deliberately claims no more than the number can support.
          */}
          <span className={drift.missing_clones.length > 0 ? 'text-amber-700' : 'text-muted-foreground'}>
            {drift.missing_clones.length} repo
            {drift.missing_clones.length === 1 ? '' : 's'} with no files on disk
          </span>
        </div>

        {tables.length > 0 && (
          <div>
            {/*
              A drill-down, not a headline. Collapsed by default so the figures
              this tab is opened for — free disk, clone total, drift — stay at
              the top of the card instead of being pushed below ten table rows.
              The count travels on the toggle: it is the one thing a shut
              section can still say about what is inside it.
            */}
            <button
              type="button"
              onClick={() => setTablesOpen((open) => !open)}
              aria-expanded={tablesOpen}
              aria-controls="admin-storage-tables"
              className="flex w-full items-center gap-2 rounded text-left text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Database tables ({visibleTables.length})
              {tablesOpen ? (
                <ChevronUp className="ml-auto h-4 w-4" />
              ) : (
                <ChevronDown className="ml-auto h-4 w-4" />
              )}
            </button>

            <div
              id="admin-storage-tables"
              hidden={!tablesOpen}
              className="mt-2 overflow-x-auto"
            >
              <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th scope="col" className="py-1.5 pr-4 font-medium">Table</th>
                  <th scope="col" className="py-1.5 pr-4 text-right font-medium">Rows</th>
                  <th scope="col" className="py-1.5 text-right font-medium">Size</th>
                </tr>
              </thead>
              <tbody>
                {visibleTables.map((table) => (
                  <tr key={table.table_name} className="border-b border-border/50 last:border-0">
                    <td className="py-1.5 pr-4 font-mono text-xs">{table.table_name}</td>
                    <td className="py-1.5 pr-4 text-right tabular-nums">
                      {table.row_count.toLocaleString()}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">
                      {formatBytes(table.total_bytes)}
                    </td>
                  </tr>
                ))}
              </tbody>
              </table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
