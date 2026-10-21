import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ListChecks, TriangleAlert } from 'lucide-react'
import { useCurrentUser } from '@/hooks/useUsers'
import { linearErrorCode, useLinearRepoTeams } from '@/hooks/useLinear'
import { useBackState } from '@/hooks/useBackTarget'
import { openIssueCount } from '@/lib/linear'
import { cn } from '@/lib/utils'
import type { RepoLinearTeam } from '@/types'

const card = 'rounded-2xl border border-border bg-white shadow-sm'
const listBody = 'min-h-0 flex-1 divide-y divide-border overflow-y-auto'

function RepoTeamRow({ item, backState }: { item: RepoLinearTeam; backState: ReturnType<typeof useBackState> }) {
  const { status_counts: counts, active_cycle: cycle } = item.stats
  const percent = cycle ? Math.round(Math.min(Math.max(cycle.progress, 0), 1) * 100) : 0

  return (
    <div data-testid="linear-repo-team" className="px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <Link
          to={`/repos/${item.repo_id}`}
          state={backState}
          title={item.repo_name}
          className="min-w-0 truncate text-xs font-medium hover:text-brand-700"
        >
          {item.repo_name}
        </Link>
        <span className="flex flex-shrink-0 items-center gap-1.5 text-[10px] text-muted-foreground">
          <span>{item.team.name}</span>
          <span className="rounded bg-muted px-1.5 py-0.5 font-mono">{item.team.key}</span>
        </span>
      </div>
      <p className="mt-1 text-[10px] tabular-nums text-muted-foreground">
        {openIssueCount(counts)} open · {counts.started} in progress · {counts.completed} done
      </p>
      {cycle && (
        <div className="mt-2 flex items-center gap-2">
          <span className="flex-shrink-0 text-[10px] text-muted-foreground">Cycle {cycle.number}</span>
          <div
            role="progressbar"
            aria-label={`${item.repo_name} cycle progress`}
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
            className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
          >
            {/* Inline width, as in the chart primitives: it is data, not style. */}
            <div className="h-full rounded-full bg-brand-500 transition-[width] duration-500" style={{ width: `${percent}%` }} />
          </div>
          <span className="w-8 text-right text-[10px] tabular-nums text-muted-foreground">{percent}%</span>
        </div>
      )}
    </div>
  )
}

/**
 * The Linear teams behind the dashboard's repos, in the slot the Needs
 * attention list held: one row per repo that has a team, the same team its
 * Repo Detail panel shows. Follows the collection picker, like the cards
 * around it. Read with the viewer's own key, so nothing is fetched until the
 * viewer has one.
 */
export function LinearTeamsPanel({ collectionId, className }: { collectionId: string; className?: string }) {
  const backState = useBackState()
  const { data: me, isPending: mePending } = useCurrentUser()
  const configured = Boolean(me?.linear_api_key_configured)
  const { data, isPending, error, refetch, isFetching } = useLinearRepoTeams(collectionId, configured)
  const items = data?.items ?? []

  let body: ReactNode
  if (mePending || (configured && isPending)) {
    body = <p className="px-4 py-3 text-xs text-muted-foreground">Loading Linear…</p>
  } else if (!configured) {
    body = (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-5 text-center">
        <ListChecks className="h-7 w-7 text-brand-300" />
        <p className="text-xs text-muted-foreground">
          Connect Linear to see your repos&apos; teams here.{' '}
          <Link to="/settings" className="font-medium text-brand-600 hover:underline">Add your Linear API key in Settings</Link>
        </p>
      </div>
    )
  } else if (error) {
    body = linearErrorCode(error) === 'linear_key_invalid' ? (
      <p className="m-4 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
        <TriangleAlert className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
        <span>
          Linear rejected your API key.{' '}
          <Link to="/settings" className="font-medium underline">Update it in Settings</Link>
        </span>
      </p>
    ) : (
      <div className="flex items-center justify-between gap-2 px-4 py-3 text-xs text-muted-foreground">
        <span>Couldn&apos;t load Linear right now.</span>
        <button
          type="button"
          disabled={isFetching}
          onClick={() => void refetch()}
          className="rounded-md border border-border px-2 py-1 font-medium hover:bg-brand-50 disabled:opacity-50"
        >
          Retry
        </button>
      </div>
    )
  } else if (items.length === 0) {
    body = (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-5 text-center">
        <ListChecks className="h-7 w-7 text-brand-300" />
        <p className="text-xs font-medium text-muted-foreground">No Linear teams linked yet.</p>
        <p className="text-[11px] text-muted-foreground">
          Link one from a repo&apos;s page, or name the repo after its team to match it automatically.
        </p>
      </div>
    )
  } else {
    body = items.map(item => <RepoTeamRow key={item.repo_id} item={item} backState={backState} />)
  }

  return (
    <section aria-label="Linear teams" className={cn(card, 'flex h-64 min-h-0 flex-col xl:h-auto', className)}>
      <div className="flex flex-shrink-0 items-center justify-between gap-2 px-4 pt-3 pb-2">
        <h2 className="text-sm font-semibold">Linear teams</h2>
        {data && (
          <span data-testid="linear-repo-team-count" className="rounded-full bg-brand-100 px-2 py-0.5 text-xs font-medium text-brand-700 tabular-nums">
            {data.total}
          </span>
        )}
      </div>
      <div data-testid="linear-repo-teams-list" className={listBody}>
        {body}
      </div>
    </section>
  )
}
