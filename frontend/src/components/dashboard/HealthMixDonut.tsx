import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts'
import { Link } from 'react-router-dom'
import { GitBranch } from 'lucide-react'
import { healthMix } from '@/lib/dashboardInsights'
import { HEALTH_STATUS_LABELS } from '@/components/HealthBadge'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useBackState } from '@/hooks/useBackTarget'
import { cn } from '@/lib/utils'
import type { HealthStatus, Repo } from '@/types'

const SLICE_FILL: Record<HealthStatus, string> = { green: '#10b981', yellow: '#f59e0b', red: '#f43f5e', unknown: '#94a3b8' }
const DOT_CLASS: Record<HealthStatus, string> = { green: 'bg-emerald-500', yellow: 'bg-amber-500', red: 'bg-rose-500', unknown: 'bg-slate-400' }
const TILE_CLASS: Record<HealthStatus, string> = {
  green: 'border-emerald-200 bg-emerald-100 text-emerald-700 hover:bg-emerald-200',
  yellow: 'border-amber-200 bg-amber-100 text-amber-700 hover:bg-amber-200',
  red: 'border-rose-200 bg-rose-100 text-rose-700 hover:bg-rose-200',
  unknown: 'border-slate-200 bg-slate-100 text-slate-500 hover:bg-slate-200',
}

export function HealthMixDonut({ repos, className, loading, failed, selectedStatus, onSelectStatus }: {
  repos: Repo[]; className?: string; loading?: boolean; failed?: boolean
  selectedStatus?: HealthStatus | null; onSelectStatus?: (status: HealthStatus) => void
}) {
  const mix = healthMix(repos)
  const healthyPct = repos.length === 0 ? 0 : Math.round((mix[0].count / repos.length) * 100)
  const slices = mix.filter(slice => slice.count > 0)
  const backState = useBackState()

  return (
    <TooltipProvider delayDuration={0}>
    <section aria-label="Health mix" className={cn('flex min-h-64 min-w-0 flex-col rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm xl:min-h-0', className)}>
      <div className="flex items-center justify-between"><h2 className="text-sm font-semibold">Health mix</h2><span className="text-[10px] font-medium uppercase tracking-widest text-slate-400">Explore</span></div>
      {loading || failed ? <p className="my-auto text-center text-xs text-slate-500">{loading ? 'Loading health data…' : 'Health data is unavailable.'}</p> : <>
        <div className="flex flex-1 items-center justify-center gap-2 py-2">
          <div className="relative h-24 w-24 flex-shrink-0">
            {slices.length === 0 ? <p className="flex h-full items-center justify-center text-xs text-slate-400">Nothing scored</p> : <>
              <ResponsiveContainer width="100%" height="100%"><PieChart>
                <Pie data={slices} dataKey="count" nameKey="label" innerRadius="76%" outerRadius="100%" paddingAngle={4} stroke="none" cornerRadius={4}>
                  {slices.map(slice => <Cell key={slice.status} fill={SLICE_FILL[slice.status]} />)}
                </Pie>
              </PieChart></ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-2xl font-semibold tracking-tight tabular-nums">{healthyPct}%</span><span className="text-[10px] text-slate-500">healthy</span>
              </div>
            </>}
          </div>
          <ul className="min-w-0 flex-1 space-y-1">
            {mix.map(slice => <li key={slice.status}>
              <button type="button" aria-label={`Show ${slice.label} repositories`} aria-pressed={selectedStatus === slice.status} onClick={() => onSelectStatus?.(slice.status)} className={cn('flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-xs transition-colors hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-brand-500', selectedStatus === slice.status && 'bg-brand-50 ring-1 ring-brand-200')}>
                <span className={cn('h-1.5 w-1.5 flex-shrink-0 rounded-full', DOT_CLASS[slice.status])} /><span className="flex-1 text-left text-slate-500">{slice.label}</span><span className="font-semibold tabular-nums">{slice.count}</span>
              </button>
            </li>)}
          </ul>
        </div>
        <div className="min-h-0 flex-shrink-0 border-t border-slate-100 pt-2">
          <p className="mb-2 text-[10px] text-slate-400">Repository map · select a tile</p>
          <nav aria-label="Repository health map" className="flex max-h-12 flex-wrap gap-1 overflow-y-auto">
            {repos.map(repo => {
              const label = `${repo.name} · ${HEALTH_STATUS_LABELS[repo.health_status]}`
              return (
                <Tooltip key={repo.id}>
                  <TooltipTrigger asChild>
                    <Link to={`/repos/${repo.id}`} state={backState} title={label} aria-label={label} className={cn('flex h-5 w-5 items-center justify-center rounded-md border transition-transform hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-brand-500', TILE_CLASS[repo.health_status])}>
                      <GitBranch className="h-2.5 w-2.5" />
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs">{label}</TooltipContent>
                </Tooltip>
              )
            })}
          </nav>
        </div>
      </>}
    </section>
    </TooltipProvider>
  )
}
