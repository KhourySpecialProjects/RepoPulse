import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui'
import { useAdminOverview } from '@/hooks/useAdminStats'
import type { AdminHealthDistribution, AdminOverview } from '@/types'

/**
 * Instance-wide overview: entity counts, fleet health, sync freshness.
 *
 * Computed server-side in SQL. DashboardPage builds its totals by fanning out
 * a request per collection and then per repo, which is O(collections x pages)
 * round trips and only ever sees the caller's accessible collections. An
 * admin view is instance-wide by definition, so it is one request.
 */

const HEALTH_ORDER: Array<{
  key: keyof AdminHealthDistribution
  label: string
  dot: string
}> = [
  { key: 'green', label: 'Healthy', dot: 'bg-emerald-500' },
  { key: 'yellow', label: 'At risk', dot: 'bg-amber-500' },
  { key: 'red', label: 'Failing', dot: 'bg-red-500' },
  { key: 'unknown', label: 'Unknown', dot: 'bg-gray-400' },
]

function MetricTile({
  label,
  value,
  detail,
  testId,
}: {
  label: string
  value: number
  detail?: string
  testId: string
}) {
  return (
    <div
      data-testid={testId}
      className="rounded-lg border border-border bg-card p-4 shadow-sm"
    >
      <div className="text-2xl font-semibold tabular-nums">
        {value.toLocaleString()}
      </div>
      <div className="text-sm text-muted-foreground">{label}</div>
      {detail && <div className="mt-0.5 text-xs text-muted-foreground">{detail}</div>}
    </div>
  )
}

/**
 * Exactly one administrator is a lockout risk; zero is unrecoverable through
 * the UI. This is the only place an admin would find that out before it
 * matters, so it is a banner rather than a number in a grid.
 */
function AdminCountWarning({ admins }: { admins: number }) {
  if (admins === 0) {
    return (
      <div
        role="alert"
        data-testid="admin-count-warning"
        className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
      >
        <strong>No administrators.</strong> Nobody can reach this page or manage
        users. Recovering requires changing a role directly in the database.
      </div>
    )
  }
  if (admins === 1) {
    return (
      <div
        role="status"
        data-testid="admin-count-warning"
        className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
      >
        <strong>Only one administrator.</strong> If that account is lost, admin
        access is lost with it. Consider promoting a second.
      </div>
    )
  }
  return null
}

function SyncPanel({ sync }: { sync: AdminOverview['sync'] }) {
  const needsAttention = sync.never_synced + sync.stale
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Sync freshness</CardTitle>
        <CardDescription>
          Stale means no sync in the last {sync.stale_after_days} days.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div data-testid="sync-summary" className="grid grid-cols-3 gap-4">
          <div>
            <div className="text-xl font-semibold tabular-nums">{sync.fresh}</div>
            <div className="text-xs text-muted-foreground">fresh</div>
          </div>
          <div>
            <div
              className={`text-xl font-semibold tabular-nums ${sync.stale > 0 ? 'text-amber-700' : ''}`}
            >
              {sync.stale}
            </div>
            <div className="text-xs text-muted-foreground">stale</div>
          </div>
          <div>
            <div
              className={`text-xl font-semibold tabular-nums ${sync.never_synced > 0 ? 'text-amber-700' : ''}`}
            >
              {sync.never_synced}
            </div>
            <div className="text-xs text-muted-foreground">never synced</div>
          </div>
        </div>

        {needsAttention > 0 && (
          <p data-testid="stale-note" className="mt-3 text-xs text-muted-foreground">
            Repos that have not synced are scored <em>unknown</em>, not unhealthy
            — a rising unknown count is an operations problem, not a student one.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

export function AdminOverviewTab() {
  const { data, isLoading, isError, refetch } = useAdminOverview()

  if (isLoading) {
    return (
      <div data-testid="overview-loading" className="grid gap-4 sm:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="h-24 animate-pulse rounded-lg bg-muted" />
        ))}
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div role="alert" className="flex items-center gap-3 text-sm">
        <span className="text-muted-foreground">
          Could not load the instance overview.
        </span>
        <button
          type="button"
          onClick={() => refetch()}
          className="rounded border border-border px-2 py-1 text-xs hover:bg-muted"
        >
          Retry
        </button>
      </div>
    )
  }

  const { counts, health } = data
  const totalRepos = health.green + health.yellow + health.red + health.unknown

  return (
    <div className="flex flex-col gap-6">
      <AdminCountWarning admins={counts.admins} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricTile testId="metric-repos" label="Repositories" value={counts.repos} />
        <MetricTile
          testId="metric-collections"
          label="Collections"
          value={counts.collections}
          detail={
            counts.archived_collections > 0
              ? `${counts.archived_collections} archived`
              : undefined
          }
        />
        <MetricTile
          testId="metric-users"
          label="Users"
          value={counts.users}
          detail={`${counts.admins} admin · ${counts.instructors} instructor · ${counts.tas} TA`}
        />
        <MetricTile
          testId="metric-contributors"
          label="Contributors"
          value={counts.contributors}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Fleet health</CardTitle>
          <CardDescription>Across every repository in the instance.</CardDescription>
        </CardHeader>
        <CardContent>
          {totalRepos === 0 ? (
            <p className="text-sm text-muted-foreground">
              No repositories yet.
            </p>
          ) : (
            <>
              <div
                data-testid="health-bar"
                className="flex h-2 w-full overflow-hidden rounded-full bg-muted"
              >
                {HEALTH_ORDER.map(({ key, dot }) =>
                  health[key] > 0 ? (
                    <div
                      key={key}
                      className={dot}
                      style={{ width: `${(health[key] / totalRepos) * 100}%` }}
                    />
                  ) : null,
                )}
              </div>
              {/* All four statuses always render, including zeros: a chart
                  that omits "red" when nothing is red is misleading. */}
              <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
                {HEALTH_ORDER.map(({ key, label, dot }) => (
                  <span
                    key={key}
                    data-testid={`health-${key}`}
                    className="inline-flex items-center gap-1.5 text-sm"
                  >
                    <span className={`h-2 w-2 rounded-full ${dot}`} />
                    <span className="font-semibold tabular-nums">{health[key]}</span>
                    <span className="text-muted-foreground">{label}</span>
                  </span>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <SyncPanel sync={data.sync} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Content</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            {(
              [
                ['Notes', counts.notes],
                ['Summaries', counts.summaries],
                ['Classified commits', counts.commit_classifications],
                ['Pull requests', counts.pull_requests],
              ] as const
            ).map(([label, value]) => (
              <div key={label}>
                <div className="text-lg font-semibold tabular-nums">
                  {value.toLocaleString()}
                </div>
                <div className="text-xs text-muted-foreground">{label}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
