import { useQueries, useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { Activity, Folder, Mail } from 'lucide-react'
import { HealthBadge } from '@/components/HealthBadge'
import { NotificationIcon } from '@/components/NotificationIcon'
import { useMarkNotificationRead, useNotifications } from '@/hooks/useNotifications'
import { getCollections, getRepos } from '@/services/api'
import { feedTitleFor } from '@/lib/notificationEvents'
import { notificationTarget } from '@/lib/notificationTarget'
import { formatTimeAgo } from '@/lib/time'
import type { Notification, PaginatedResponse, Repo } from '@/types'
import { PAGE_HEADER_CLASS, PAGE_BODY_CLASS } from '@/lib/layout'

// Read every page so overview totals never silently stop at the API page limit.
async function allPages<T>(fetchPage: (offset: number) => Promise<PaginatedResponse<T>>) {
  const items: T[] = []
  for (;;) {
    const page = await fetchPage(items.length)
    items.push(...page.items)
    if (!page.items.length || items.length >= page.total) return items
  }
}

const hoverCard = 'transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-1 hover:shadow-md hover:border-brand-200 motion-reduce:transform-none motion-reduce:transition-none'
const panel = 'rounded-lg border border-border bg-card shadow-sm'
// brand-100, not the fainter 50 used for surfaces: a pulse has to be visible
// against the white card it sits on.
const skeleton = 'animate-pulse rounded-lg bg-brand-100'

/** How many unread items the panel lists before deferring to the full page. */
const NOTIFICATION_LIMIT = 8

function lastCommit(repo: Repo) {
  return repo.last_commit_at ? new Date(repo.last_commit_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'No commits indexed'
}

/**
 * The unread half of the notification feed.
 *
 * Fetches on its own rather than taking props, so a slow fan-out over every
 * collection's repos never holds up the inbox — the two panels in this row
 * load independently.
 */
function RecentNotificationsPanel() {
  const navigate = useNavigate()
  const { data, isPending, isError } = useNotifications({ unread_only: true, limit: NOTIFICATION_LIMIT })
  const markRead = useMarkNotificationRead()

  const items = data?.items ?? []
  // The feed is capped at NOTIFICATION_LIMIT rows but the badge reports the
  // real backlog, so a ninth unread item is not silently invisible.
  const unread = data?.unread_count ?? 0

  async function open(notification: Notification) {
    await markRead.mutateAsync(notification.id)
    const target = notificationTarget(notification)
    if (target) navigate(target)
  }

  return (
    <section aria-label="Recent notifications" className={panel}>
      <div className="flex items-start justify-between gap-3 border-b border-border p-4">
        <div>
          <h2 className="font-medium">Recent notifications {unread > 0 && <span className="ml-1 rounded-full bg-brand-100 px-2 py-0.5 text-xs font-medium text-brand-700">{unread}</span>}</h2>
          <p className="mt-1 text-xs text-muted-foreground">Mentions, replies, reminders and repo activity you have not read.</p>
        </div>
        <Link to="/notifications" className="shrink-0 text-xs font-medium text-brand-600 hover:underline">View all →</Link>
      </div>

      {isPending ? <div role="status" className="p-4"><p className="text-sm text-muted-foreground">Loading notifications…</p><div className={`mt-3 h-24 ${skeleton}`} /></div>
        : isError ? <p className="p-4 text-sm text-muted-foreground">Notifications could not be loaded.</p>
        : !items.length ? <p className="p-4 text-sm text-muted-foreground">No unread notifications. You are all caught up.</p>
        : <ul className="max-h-80 divide-y divide-border overflow-auto">
            {items.map(notification => <li key={notification.id} data-testid="dashboard-notification" className="bg-brand-100/50">
              <button type="button" onClick={() => open(notification)} className="flex w-full items-start gap-3 p-4 text-left hover:bg-accent/50">
                <NotificationIcon type={notification.type} className="mt-0.5 h-4 w-4 shrink-0" />
                <span className="min-w-0 flex-1">
                  {/* Repo events carry their own subject; note-scoped ones use
                      the per-type title and quote the note underneath. */}
                  <span className="block truncate text-sm font-medium">{notification.subject ?? feedTitleFor(notification.type)}</span>
                  {(notification.note_content_preview ?? notification.body) && <span className="mt-0.5 block truncate text-sm text-muted-foreground">{notification.note_content_preview ?? notification.body}</span>}
                  <span className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                    {formatTimeAgo(notification.created_at)}
                    {notification.emailed_at && <span title="Also delivered by email" className="inline-flex items-center gap-0.5"><Mail className="h-3 w-3" />emailed</span>}
                  </span>
                </span>
                {/* Unread marker — an accent, not a warning, so it reads brand. */}
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-orchid-500" />
              </button>
            </li>)}
          </ul>}
    </section>
  )
}

export function DashboardPage() {
  const collectionsQuery = useQuery({
    queryKey: ['collections', 'dashboard'],
    queryFn: () => allPages(offset => getCollections(50, offset)),
  })
  const collections = collectionsQuery.data ?? []
  const repoQueries = useQueries({ queries: collections.map(collection => ({
    queryKey: ['repos', 'dashboard', collection.id],
    queryFn: () => allPages(offset => getRepos(collection.id, 50, offset)),
  })) })
  const loading = collectionsQuery.isPending || repoQueries.some(query => query.isPending)
  const failed = collectionsQuery.isError || repoQueries.some(query => query.isError)
  const repos = repoQueries.flatMap(query => query.data ?? [])
  const attention = repos.filter(repo => repo.health_status === 'red' || repo.health_status === 'yellow')
    .sort((a, b) => Number(b.health_status === 'red') - Number(a.health_status === 'red'))
  const healthy = repos.filter(repo => repo.health_status === 'green').length
  const metrics = [
    { label: 'Healthy repositories', value: healthy, detail: 'Based on latest indexed health', icon: Activity },
    { label: 'Need attention', value: attention.length, detail: 'At risk or below health targets', icon: Folder },
  ]

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div data-testid="page-header" className={PAGE_HEADER_CLASS}>
        <div>
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Workspace overview</p>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        </div>
      </div>

      <div className={`${PAGE_BODY_CLASS} w-full space-y-4`}>
        <p className="text-sm text-muted-foreground">Know where things stand. See what needs your attention.</p>

        {failed && <div role="alert" className="rounded-xl border border-amber-200 p-4 text-sm text-amber-800">Some dashboard data could not be loaded. Totals are hidden until all collections load. <button className="underline" onClick={() => { void collectionsQuery.refetch(); repoQueries.forEach(query => { void query.refetch() }) }}>Retry</button></div>}

        <section aria-label="Workspace metrics" className="grid gap-3 sm:grid-cols-2">
          {metrics.map(metric => <div key={metric.label} className={`${panel} ${hoverCard} p-4`}>
            <div className="flex items-center justify-between text-sm text-muted-foreground">{metric.label}<metric.icon className="h-4 w-4 text-muted-foreground" /></div>
            {loading ? <div aria-label="Loading metric" className={`my-4 h-9 w-20 ${skeleton}`} /> : <p className="my-2 text-3xl font-medium tracking-tight text-brand-700">{failed ? '—' : metric.value}</p>}
            <p className="text-xs text-muted-foreground">{loading || failed ? 'Awaiting workspace data' : metric.detail}</p>
          </div>)}
        </section>

        {!loading && !failed && collections.length === 0 && <section className={`${panel} p-8 text-center`}><h2 className="text-xl font-medium">Start with a collection</h2><p className="mt-2 text-sm text-muted-foreground">Add your projects to see health, activity, and follow-ups here.</p><Link className="mt-4 inline-block text-sm font-medium text-brand-600 hover:underline" to="/collections">Create your first collection →</Link></section>}

        <div className="grid items-start gap-4 lg:grid-cols-2">
          <section className={panel}>
            <div className="border-b border-border p-4"><h2 className="font-medium">Needs your attention <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">{loading ? '—' : attention.length}</span></h2><p className="mt-1 text-xs text-muted-foreground">Review these repositories first.</p></div>
            {loading ? <div role="status" className="p-4"><p className="text-sm text-muted-foreground">Loading your repository insights…</p><div className={`mt-3 h-24 ${skeleton}`} /></div> : <>
              <div className="max-h-80 divide-y divide-border overflow-auto">{attention.map(repo => <Link key={repo.id} to={`/repos/${repo.id}`} className="flex items-center justify-between gap-3 p-4 hover:bg-accent/50"><div className="min-w-0"><p className="truncate text-sm font-medium">{repo.name}</p><p className="mt-1 text-xs text-muted-foreground">Last commit · {lastCommit(repo)}</p></div><HealthBadge status={repo.health_status} className="shrink-0" /></Link>)}</div>
              {!attention.length && <p className="p-4 text-sm text-muted-foreground">{failed ? 'No attention items in the available data.' : 'No repositories currently flagged for attention.'}</p>}
            </>}
          </section>

          <RecentNotificationsPanel />
        </div>

        <p className="text-xs text-muted-foreground">Active collections only. Insights reflect the latest synced repository data.</p>
      </div>
    </div>
  )
}
