import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowUpRight, GitBranch, Bell, GitCommit, AlertTriangle, RefreshCw, X, ArrowRight, Layers, CheckCircle2 } from 'lucide-react'
import { HealthBadge, HEALTH_STATUS_LABELS } from '@/components/HealthBadge'
import { MetricTile } from '@/components/dashboard/MetricTile'
import { WorkspacePulseChart } from '@/components/dashboard/WorkspacePulseChart'
import { HealthMixDonut } from '@/components/dashboard/HealthMixDonut'
import { HealthSignalRadar } from '@/components/dashboard/HealthSignalRadar'
import { StalenessChart } from '@/components/dashboard/StalenessChart'
import { WorkspaceInsights } from '@/components/dashboard/WorkspaceInsights'
import { DashboardSearch } from '@/components/dashboard/DashboardSearch'
import { useDashboard } from '@/hooks/useDashboard'
import { useWorkspacePeople } from '@/hooks/useWorkspacePeople'
import {
  activityTrend,
  averageHealthSignals,
  buildInsights,
  mergeDailyActivity,
} from '@/lib/dashboardInsights'
import { cn } from '@/lib/utils'
import type { HealthStatus, Repo } from '@/types'
import { PAGE_HEADER_CLASS, PAGE_BODY_CLASS } from '@/lib/layout'
import { useBackState } from '@/hooks/useBackTarget'

const card = 'rounded-2xl border border-slate-200/80 bg-white shadow-sm'
const listBody = 'min-h-0 flex-1 divide-y divide-slate-100 overflow-y-auto'

const tileGrid = { hidden: {}, visible: { transition: { staggerChildren: 0.05 } } }

function lastCommit(repo: Repo) {
  return repo.last_commit_at
    ? new Date(repo.last_commit_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : 'never'
}

export function DashboardPage() {
  const backState = useBackState()
  const [collectionId, setCollectionId] = useState('')
  const [healthFilter, setHealthFilter] = useState<HealthStatus | null>(null)
  const [peopleWanted, setPeopleWanted] = useState(false)
  const { collections, selected, repos, loading, failed, refreshing, refresh, activityQuery } = useDashboard(collectionId)
  // Searching people is opt-in: the endpoint behind it walks git history, so it
  // stays unfetched until the search box reports a real query.
  const peopleQuery = useWorkspacePeople(selected.map(collection => collection.id), peopleWanted)
  const wantPeople = useCallback(() => setPeopleWanted(true), [])

  const attention = repos.filter(repo => repo.health_status === 'red' || repo.health_status === 'yellow')
    .sort((a, b) => Number(b.health_status === 'red') - Number(a.health_status === 'red'))
  const reviewRepos = healthFilter ? repos.filter(repo => repo.health_status === healthFilter) : attention
  const reminders = repos.filter(repo => repo.active_reminder_count > 0).sort((a, b) => b.active_reminder_count - a.active_reminder_count)

  const signals = useMemo(() => averageHealthSignals(repos), [repos])
  const weekTrend = useMemo(() => activityTrend(activityQuery.series, 7), [activityQuery.series])
  const sparkline = useMemo(() => mergeDailyActivity(activityQuery.series, 14), [activityQuery.series])
  const insights = useMemo(
    () => buildInsights({ repos: loading || failed ? [] : repos, trend: activityQuery.isError || activityQuery.isPending ? { current: 0, previous: 0, deltaPct: null } : activityTrend(activityQuery.series, 30), signals }),
    [repos, activityQuery.series, activityQuery.isError, activityQuery.isPending, signals, loading, failed]
  )

  return (
    <div className="flex h-screen flex-col overflow-y-auto bg-slate-50 text-foreground xl:overflow-hidden [@media(max-height:680px)]:overflow-y-auto">
      {/* Symmetric outer tracks, so the search sits on the page's centre line
          rather than in the middle of whatever the title and controls leave. */}
      <div
        data-testid="page-header"
        className={cn(
          PAGE_HEADER_CLASS,
          'grid flex-shrink-0 grid-cols-1 items-center gap-3',
          'md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]'
        )}
      >
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <DashboardSearch
          repos={repos}
          people={peopleQuery.people}
          peopleLoading={peopleQuery.isPending}
          onPeopleNeeded={wantPeople}
          className="w-full md:w-72 lg:w-96"
        />
        <div className="flex min-w-0 flex-wrap items-center gap-2 md:justify-end">
          <select aria-label="Collection scope" value={collectionId} onChange={event => { setCollectionId(event.target.value); setHealthFilter(null) }} className="h-9 max-w-48 rounded-lg border border-slate-200 bg-slate-50 pl-3 pr-7 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
            <option value="">All collections</option>
            {collections.map(collection => <option key={collection.id} value={collection.id}>{collection.name}</option>)}
          </select>
          <button type="button" aria-label="Refresh dashboard" title="Refresh dashboard" disabled={refreshing} onClick={() => void refresh()} className="rounded-lg border border-slate-200 bg-white p-2 text-slate-500 transition-colors hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-50"><RefreshCw className={cn('h-4 w-4', refreshing && 'motion-safe:animate-spin')} /></button>
          <Link to="/collections" className="inline-flex flex-shrink-0 items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-indigo-700">View collections <ArrowUpRight className="h-4 w-4" /></Link>
        </div>
      </div>

      <div className={cn(PAGE_BODY_CLASS, 'flex flex-shrink-0 flex-col gap-4 px-4 pt-4 xl:min-h-0 xl:flex-1 xl:shrink xl:px-6 [@media(max-height:680px)]:flex-none')}>
        {failed && (
          <div role="alert" className="flex-shrink-0 rounded-xl border border-amber-200 p-3 text-sm text-amber-800">
            Some dashboard data could not be loaded.{' '}
            <button
              className="underline"
              onClick={() => void refresh()}
            >
              Retry
            </button>
          </div>
        )}

        <motion.section
          aria-label="Workspace metrics"
          variants={tileGrid}
          initial="hidden"
          animate="visible"
          className="grid flex-shrink-0 gap-3 sm:grid-cols-2 xl:grid-cols-4"
        >
          <MetricTile
            label={`repos · ${selected.length} collection${selected.length === 1 ? '' : 's'}`}
            value={failed ? '—' : repos.length}
            icon={GitBranch}
            accent="indigo"
            loading={loading}
          />
          <MetricTile
            label="commits · 7d"
            value={failed || activityQuery.isError ? '—' : weekTrend.current}
            detail={
              activityQuery.isError || activityQuery.isPending || weekTrend.deltaPct === null
                ? undefined
                : `${Math.abs(weekTrend.deltaPct)}% ${weekTrend.deltaPct >= 0 ? 'up' : 'down'} on the week before`
            }
            icon={GitCommit}
            accent="emerald"
            sparkline={activityQuery.isError ? undefined : sparkline}
            loading={loading || activityQuery.isPending}
          />
          <MetricTile
            label="need attention"
            value={failed ? '—' : attention.length}
            icon={AlertTriangle}
            accent="amber"
            loading={loading}
          />
          <MetricTile
            label="active reminders"
            value={failed ? '—' : repos.reduce((sum, repo) => sum + repo.active_reminder_count, 0)}
            detail={reminders.length > 0 ? `across ${reminders.length} repositor${reminders.length === 1 ? 'y' : 'ies'}` : undefined}
            icon={Bell}
            accent="violet"
            loading={loading}
          />
        </motion.section>

        {!loading && !failed && collections.length === 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-indigo-200 bg-indigo-50 p-5">
            <div className="flex items-center gap-3"><Layers className="h-6 w-6 text-indigo-500" /><p className="text-sm text-indigo-950">Every project starts somewhere. Bring your first cohort together.</p></div>
            <Link className="inline-flex items-center gap-2 text-sm font-semibold text-indigo-700" to="/collections">Create your first collection <ArrowRight className="h-4 w-4" /></Link>
          </div>
        )}
        <div className="grid flex-1 gap-4 sm:grid-cols-2 xl:min-h-0 xl:grid-cols-4 xl:grid-rows-[minmax(260px,1.15fr)_minmax(180px,1fr)]">
          <WorkspacePulseChart
            series={activityQuery.series}
            loading={loading || activityQuery.isPending}
            failed={failed || activityQuery.isError}
            onRetry={() => void activityQuery.refetch()}
            className="min-h-72 sm:col-span-2 xl:min-h-0"
          />
          <HealthMixDonut repos={repos} loading={loading} failed={failed} selectedStatus={healthFilter} onSelectStatus={setHealthFilter} />
          <HealthSignalRadar repos={repos} loading={loading} failed={failed} />

          <WorkspaceInsights insights={insights} />

          {/* With nothing to report there is no insights card, so the list
              beside it widens rather than leaving a hole in the row. */}
          <section className={cn(card, 'flex h-64 min-h-0 flex-col xl:h-auto', insights.length === 0 && 'xl:col-span-2')}>
            <div className="flex flex-shrink-0 items-center justify-between gap-2 px-4 pt-3 pb-2">
              <h2 className="text-sm font-semibold">{healthFilter ? `${HEALTH_STATUS_LABELS[healthFilter]} repositories` : 'Needs attention'}</h2>
              {healthFilter && <button aria-label="Clear health filter" onClick={() => setHealthFilter(null)} className="rounded p-1 text-slate-500 hover:bg-slate-100"><X className="h-3 w-3" /></button>}
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 tabular-nums">
                {loading || failed ? '—' : reviewRepos.length}
              </span>
            </div>
            <div data-testid="attention-list" className={listBody}>
              {!loading && !failed && reviewRepos.map(repo => (
                <Link
                  key={repo.id}
                  to={`/repos/${repo.id}`}
                  state={backState}
                  className="group flex items-center justify-between gap-2 px-4 py-3 transition-colors hover:bg-indigo-50/50"
                >
                  <span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium group-hover:text-indigo-700" title={repo.name}>{repo.name}</span><span className="mt-1 block text-[10px] text-slate-400">Last commit {lastCommit(repo)}</span></span>

                  <HealthBadge status={repo.health_status} className="flex-shrink-0 scale-90" />
                </Link>
              ))}
              {loading || failed ? <p className="px-4 py-3 text-xs text-slate-500">{loading ? 'Loading repositories…' : 'Repository data is unavailable.'}</p> : !reviewRepos.length && (
                <div className="flex h-full flex-col items-center justify-center gap-2 p-5 text-center"><CheckCircle2 className="h-7 w-7 text-emerald-500" /><p className="text-xs text-slate-500">{healthFilter ? 'No repositories with this status.' : 'Nothing flagged. Looking good.'}</p></div>
              )}
            </div>
          </section>

          <section className={cn(card, 'flex h-64 min-h-0 flex-col xl:h-auto')}>
            <div className="flex-shrink-0 px-4 pt-3 pb-2">
              <h2 className="text-sm font-semibold">Follow-ups</h2>
            </div>
            <div data-testid="followup-list" className={listBody}>
              {!loading && !failed && reminders.map(repo => (
                <Link
                  key={repo.id}
                  to={`/repos/${repo.id}`}
                  state={backState}
                  className="group flex items-center justify-between gap-2 px-4 py-3 transition-colors hover:bg-indigo-50/50"
                >
                  <span className="min-w-0 flex-1 truncate text-xs">{repo.name}</span>
                  <span className="flex-shrink-0 rounded-full bg-violet-50 px-2 py-0.5 text-[11px] text-violet-700 tabular-nums">
                    {repo.active_reminder_count}
                  </span>
                </Link>
              ))}
              {loading || failed ? <p className="px-4 py-3 text-xs text-slate-500">{loading ? 'Loading reminders…' : 'Reminder data is unavailable.'}</p> : !reminders.length && (
                <div className="flex h-full flex-col items-center justify-center gap-2 p-5 text-center"><Bell className="h-7 w-7 text-violet-300" /><p className="text-xs text-slate-500">No active reminders.</p><Link to="/notifications" className="text-xs font-medium text-indigo-600 hover:underline">View notifications →</Link></div>
              )}
            </div>
          </section>

          <StalenessChart repos={repos} loading={loading} failed={failed} />
        </div>
      </div>
    </div>
  )
}
