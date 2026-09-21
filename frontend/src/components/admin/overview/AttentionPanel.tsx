import { Link } from 'react-router-dom'
import { AlertTriangle, CheckCircle2 } from 'lucide-react'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui'
import { STATUS } from '@/lib/chartTheme'
import { useAdminAttention } from '@/hooks/useAdminStats'

/**
 * Repos carrying an operational fault, worst first.
 *
 * The one panel on this page that names individual repos, because a count of
 * broken things is not actionable and a list is.
 *
 * Reasons are operational only — failed syncs, vanished clones, absent
 * measurements. A repo whose students have stopped committing is not here: it
 * belongs to an instructor, and mixing the two would push the faults only an
 * administrator can fix below the ones they cannot.
 */
const PREVIEW_LIMIT = 5

function relativeTime(iso: string | null): string {
  if (!iso) return 'never'
  const elapsed = Date.now() - new Date(iso).getTime()
  const hours = Math.floor(elapsed / 3_600_000)
  if (hours < 1) return 'under an hour ago'
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export function AttentionPanel() {
  const { data, isLoading, isError, refetch } = useAdminAttention({
    limit: PREVIEW_LIMIT,
  })

  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Repos needing attention</CardTitle>
        <CardDescription>Operational faults only.</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div
            data-testid="attention-loading"
            className="h-24 animate-pulse rounded-lg bg-muted"
          />
        ) : isError || !data ? (
          <div role="alert" className="flex items-center gap-3 text-sm">
            <span className="text-muted-foreground">
              Could not load repos needing attention.
            </span>
            <button
              type="button"
              onClick={() => refetch()}
              className="rounded border border-border px-2 py-1 text-xs hover:bg-muted"
            >
              Retry
            </button>
          </div>
        ) : data.total === 0 ? (
          <p
            data-testid="attention-clear"
            className="flex items-center gap-2 text-sm text-muted-foreground"
          >
            <CheckCircle2
              aria-hidden="true"
              className="h-4 w-4"
              style={{ color: STATUS.good }}
            />
            Every repo is synced, measured and scored.
          </p>
        ) : (
          <>
            <ul data-testid="attention-list" className="flex flex-col divide-y divide-border">
              {data.items.map((repo) => (
                <li key={repo.id} className="py-1.5 first:pt-0">
                  {/* Two fixed lines rather than one wrapping row: in a
                      narrow column the single-row version wrapped to three
                      and the list height became unpredictable. */}
                  <div className="flex items-baseline gap-2">
                    <AlertTriangle
                      aria-hidden="true"
                      className="h-3.5 w-3.5 shrink-0 self-center"
                      style={{
                        color:
                          repo.severity >= 4 ? STATUS.critical : STATUS.warning,
                      }}
                    />
                    <Link
                      to={`/repos/${repo.id}`}
                      className="truncate text-sm font-medium hover:underline"
                    >
                      {repo.name}
                    </Link>
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                      {relativeTime(repo.last_synced_at)}
                    </span>
                  </div>
                  <div className="ml-[22px] flex flex-wrap items-center gap-1">
                    {repo.reasons.map((reason) => (
                      <span
                        key={reason.code}
                        className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
                      >
                        {reason.label}
                      </span>
                    ))}
                    <span className="text-[11px] text-muted-foreground">
                      {repo.collection_name}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
            {data.total > data.items.length && (
              <p className="mt-2 text-xs text-muted-foreground">
                {data.total - data.items.length} more not shown.
              </p>
            )}
            {/* The grouped view of the same failures lives in the sync card
                below; this list is the per-repo view. */}
          </>
        )}
      </CardContent>
    </Card>
  )
}
