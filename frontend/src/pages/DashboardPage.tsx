import { useQueries, useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ArrowUpRight, GitBranch, Bell, Folder, Activity } from 'lucide-react'
import { HealthBadge } from '@/components/HealthBadge'
import { getCollections, getRepos } from '@/services/api'
import type { PaginatedResponse, Repo } from '@/types'
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

const hoverCard = 'transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-1 hover:shadow-md hover:border-indigo-200 motion-reduce:transform-none motion-reduce:transition-none'
const panel = 'rounded-lg border border-border bg-card shadow-sm'

function lastCommit(repo: Repo) {
  return repo.last_commit_at ? new Date(repo.last_commit_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'No commits indexed'
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
  const reminders = repos.filter(repo => repo.active_reminder_count > 0).sort((a, b) => b.active_reminder_count - a.active_reminder_count)
  const recent = [...repos].filter(repo => repo.last_commit_at).sort((a, b) => Date.parse(b.last_commit_at!) - Date.parse(a.last_commit_at!)).slice(0, 6)
  const healthy = repos.filter(repo => repo.health_status === 'green').length
  const metrics = [
    { label: 'Repositories', value: repos.length, detail: `${collections.length} active collections`, icon: GitBranch },
    { label: 'Healthy repositories', value: healthy, detail: 'Based on latest indexed health', icon: Activity },
    { label: 'Need attention', value: attention.length, detail: 'At risk or below health targets', icon: Folder },
    { label: 'Active reminders', value: repos.reduce((sum, repo) => sum + repo.active_reminder_count, 0), detail: `Across ${reminders.length} repositories`, icon: Bell },
  ]

  return (
    <div className="min-h-screen bg-gray-50 text-foreground">
      <div data-testid="page-header" className={`${PAGE_HEADER_CLASS} justify-between gap-4`}>
        <div>
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Workspace overview</p>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        </div>
        <Link to="/collections" className="inline-flex flex-shrink-0 items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-700">View collections <ArrowUpRight className="h-4 w-4" /></Link>
      </div>

      <div className={`${PAGE_BODY_CLASS} w-full space-y-4`}>
        <p className="text-sm text-muted-foreground">Know where things stand. See what needs your attention.</p>

        {failed && <div role="alert" className="rounded-xl border border-amber-200 p-4 text-sm text-amber-800">Some dashboard data could not be loaded. Totals are hidden until all collections load. <button className="underline" onClick={() => { void collectionsQuery.refetch(); repoQueries.forEach(query => { void query.refetch() }) }}>Retry</button></div>}

        <section aria-label="Workspace metrics" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {metrics.map(metric => <div key={metric.label} className={`${panel} ${hoverCard} p-4`}>
            <div className="flex items-center justify-between text-sm text-muted-foreground">{metric.label}<metric.icon className="h-4 w-4 text-muted-foreground" /></div>
            {loading ? <div aria-label="Loading metric" className="my-4 h-9 w-20 animate-pulse rounded bg-neutral-100" /> : <p className="my-2 text-3xl font-medium tracking-tight">{failed ? '—' : metric.value}</p>}
            <p className="text-xs text-muted-foreground">{loading || failed ? 'Awaiting workspace data' : metric.detail}</p>
          </div>)}
        </section>

        {loading ? <div role="status" className={`${panel} p-6`}><p className="text-sm text-muted-foreground">Loading your repository insights…</p><div className="mt-4 h-48 animate-pulse rounded-lg bg-neutral-100" /></div> : <>
          {!failed && collections.length === 0 && <section className={`${panel} p-8 text-center`}><h2 className="text-xl font-medium">Start with a collection</h2><p className="mt-2 text-sm text-muted-foreground">Add your projects to see health, activity, and follow-ups here.</p><Link className="mt-4 inline-block text-sm text-indigo-600" to="/collections">Create your first collection →</Link></section>}

          <div className="grid items-start gap-4 lg:grid-cols-2">
            <section className={panel}>
              <div className="border-b border-border p-4"><h2 className="font-medium">Needs your attention <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">{attention.length}</span></h2><p className="mt-1 text-xs text-muted-foreground">Review these repositories first.</p></div>
              <div className="max-h-80 overflow-auto divide-y divide-border">{attention.map(repo => <Link key={repo.id} to={`/repos/${repo.id}`} className="flex items-center justify-between gap-3 p-4 hover:bg-accent/50"><div className="min-w-0"><p className="truncate text-sm font-medium">{repo.name}</p><p className="mt-1 text-xs text-muted-foreground">Last commit · {lastCommit(repo)}</p></div><HealthBadge status={repo.health_status} className="shrink-0" /></Link>)}</div>
              {!attention.length && <p className="p-4 text-sm text-muted-foreground">{failed ? 'No attention items in the available data.' : 'No repositories currently flagged for attention.'}</p>}
            </section>
            <section className={panel}>
              <div className="border-b border-border p-4"><h2 className="font-medium">Follow-ups</h2><p className="mt-1 text-xs text-muted-foreground">Repositories with active reminders.</p></div>
              <div className="max-h-80 overflow-auto divide-y divide-border">{reminders.map(repo => <Link key={repo.id} to={`/repos/${repo.id}`} className="flex items-center justify-between gap-3 p-4 hover:bg-accent/50"><span className="truncate text-sm">{repo.name}</span><span className="shrink-0 rounded-full bg-violet-50 px-2 py-1 text-xs text-violet-700">{repo.active_reminder_count} reminders</span></Link>)}</div>
              {!reminders.length && <p className="p-4 text-sm text-muted-foreground">No active reminders in the available repositories.</p>}
            </section>
          </div>

          <section className={panel}>
            <div className="flex items-center justify-between border-b border-border p-4"><div><h2 className="font-medium">Recently active repositories</h2><p className="mt-1 text-xs text-muted-foreground">Ordered by latest indexed commit.</p></div><Activity className="h-4 w-4 text-indigo-600" /></div>
            <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-neutral-50 text-xs text-muted-foreground"><tr><th className="p-4 font-medium">Repository</th><th className="p-4 font-medium">Health</th><th className="p-4 font-medium">Contributors</th><th className="p-4 font-medium">Last commit</th></tr></thead><tbody>{recent.map(repo => <tr key={repo.id} className="border-t border-border"><td className="p-4"><Link className="inline-flex items-center gap-2 text-indigo-600 hover:underline" to={`/repos/${repo.id}`}>{repo.name}<ArrowUpRight className="h-3 w-3" /></Link></td><td className="p-4"><HealthBadge status={repo.health_status} className="whitespace-nowrap" /></td><td className="p-4">{repo.contributor_count}</td><td className="whitespace-nowrap p-4 text-muted-foreground">{lastCommit(repo)}</td></tr>)}</tbody></table></div>
            {!recent.length && <p className="p-4 text-sm text-muted-foreground">No indexed commit activity yet. Open a repository to sync it.</p>}
          </section>

          <section><div className="mb-3 flex items-center justify-between"><h2 className="font-medium">Your collections</h2><Link to="/collections" className="text-sm text-indigo-600 hover:underline">View all →</Link></div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{collections.map(collection => <Link to={`/collections/${collection.id}`} key={collection.id} className={`${panel} ${hoverCard} p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400`}><div className="flex items-center justify-between gap-2"><h3 className="truncate text-sm font-medium">{collection.name}</h3><ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground" /></div><p className="mt-2 text-xs text-muted-foreground">{collection.repo_count} repositories{collection.course_tag ? ` · ${collection.course_tag}` : ''}</p><div className="mt-4 flex flex-wrap gap-2 text-xs"><span className="rounded-full border border-emerald-200 bg-emerald-100 px-2 py-1 text-emerald-700">{collection.health_green} healthy</span><span className="rounded-full border border-amber-200 bg-amber-100 px-2 py-1 text-amber-700">{collection.health_yellow} at risk</span><span className="rounded-full border border-red-200 bg-red-100 px-2 py-1 text-red-700">{collection.health_red} critical</span></div></Link>)}</div></section>
        </>}
        <p className="text-xs text-muted-foreground">Active collections only. Insights reflect the latest synced repository data.</p>
      </div>
    </div>
  )
}
