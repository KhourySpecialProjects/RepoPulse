import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui'
import { useAdminStorage } from '@/hooks/useAdminStats'
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

        <p data-testid="measured-at" className="text-xs text-muted-foreground">
          Sizes as of {formatWhen(clones.newest_measurement)} — not live.
        </p>

        <div data-testid="drift" className="flex flex-col gap-1 text-xs">
          <span className={drift.orphan_directories.length > 0 ? 'text-amber-700' : 'text-muted-foreground'}>
            {drift.orphan_directories.length} clone
            {drift.orphan_directories.length === 1 ? '' : 's'} on disk with no
            repo record
            {drift.orphan_bytes !== null && ` (${formatBytes(drift.orphan_bytes)})`}
          </span>
          <span className={drift.missing_clones.length > 0 ? 'text-amber-700' : 'text-muted-foreground'}>
            {drift.missing_clones.length} repo
            {drift.missing_clones.length === 1 ? '' : 's'} with a missing clone
          </span>
        </div>

        {tables.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th scope="col" className="py-1.5 pr-4 font-medium">Table</th>
                  <th scope="col" className="py-1.5 pr-4 text-right font-medium">Rows</th>
                  <th scope="col" className="py-1.5 text-right font-medium">Size</th>
                </tr>
              </thead>
              <tbody>
                {tables.slice(0, 10).map((table) => (
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
        )}
      </CardContent>
    </Card>
  )
}
