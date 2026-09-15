import { useId, useMemo, useState } from 'react'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { TrendingUp, TrendingDown, Minus, ArrowUpRight } from 'lucide-react'
import { mergeDailyActivity, activityTrend } from '@/lib/dashboardInsights'
import { cn } from '@/lib/utils'
import { BRAND } from '@/lib/theme'
import type { CommitActivityPoint } from '@/types'

const RANGES = [{ days: 14, label: '14d' }, { days: 30, label: '30d' }, { days: 90, label: '90d' }] as const
type RangeDays = (typeof RANGES)[number]['days']
function shortDate(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

export function WorkspacePulseChart({ series, loading = false, failed = false, onRetry, className }: {
  series: CommitActivityPoint[][]; loading?: boolean; failed?: boolean; onRetry?: () => void; className?: string
}) {
  const [days, setDays] = useState<RangeDays>(30)
  const gradientId = useId()
  const points = useMemo(() => mergeDailyActivity(series, days), [series, days])
  const trend = useMemo(() => activityTrend(series, days), [series, days])
  const peak = useMemo(() => points.reduce((best, point) => point.count > best.count ? point : best, points[0]), [points])
  const rising = trend.deltaPct !== null && trend.deltaPct > 0
  const falling = trend.deltaPct !== null && trend.deltaPct < 0
  const TrendIcon = rising ? TrendingUp : falling ? TrendingDown : Minus
  const activeDays = points.filter(point => point.count > 0).length

  return (
    <section aria-label="Workspace pulse" className={cn('relative flex min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm', className)}>
      <div className="relative flex items-center justify-between gap-2 px-5 pt-4">
        <h2 className="text-sm font-semibold">Workspace pulse</h2>
        <div className="flex gap-1 rounded-lg border border-slate-200 bg-slate-50 p-0.5" aria-label="Activity period">
          {RANGES.map(range => <button key={range.days} type="button" onClick={() => setDays(range.days)} aria-pressed={days === range.days} className={cn('rounded-md px-2 py-1 text-[11px] font-medium transition-colors focus-visible:ring-2 focus-visible:ring-brand-500', days === range.days ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-200/70')}>{range.label}</button>)}
        </div>
      </div>
      {failed ? <div role="status" className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-sm text-slate-500"><p>Commit activity is unavailable.</p><button onClick={onRetry} className="rounded-lg border border-slate-200 px-3 py-2 text-xs text-brand-600 hover:bg-slate-50">Retry activity</button></div> : <>
        <div className="relative flex flex-wrap items-baseline gap-x-3 gap-y-1 px-5 pt-3">
          <span className="text-4xl font-semibold tracking-tighter tabular-nums">{loading ? '—' : trend.current}</span>
          <span className="text-xs text-slate-500">commits in {days} days</span>
          {!loading && <span className={cn('ml-auto inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-medium', rising ? 'bg-emerald-50 text-emerald-700' : falling ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-slate-500')}><TrendIcon className="h-3 w-3" />{trend.deltaPct === null ? 'no prior commits' : `${Math.abs(trend.deltaPct)}% ${rising ? 'up' : falling ? 'down' : 'flat'}`}</span>}
        </div>
        <div className="relative min-h-24 flex-1 px-2 pt-3">
          {loading ? <div aria-label="Loading commit activity" className="m-2 h-24 animate-pulse rounded-xl bg-slate-100" /> : <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={points} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
              <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={BRAND.violet} stopOpacity={0.35} /><stop offset="100%" stopColor={BRAND.violet} stopOpacity={0} /></linearGradient></defs>
              <CartesianGrid strokeDasharray="3 5" vertical={false} stroke="#e5e7eb" />
              <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 10, fill: '#6b7280' }} interval={Math.max(0, Math.floor(points.length / 6) - 1)} tickLine={false} axisLine={false} />
              <YAxis allowDecimals={false} width={28} tick={{ fontSize: 10, fill: '#6b7280' }} tickLine={false} axisLine={false} />
              <Tooltip content={({ active, payload, label }) => active && payload?.length ? <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg"><p className="text-slate-500">{shortDate(String(label))}</p><p className="mt-1 font-semibold text-brand-600">{payload[0].value} commits</p></div> : null} />
              <Area type="monotone" dataKey="count" stroke={BRAND.violet} strokeWidth={2.5} fill={`url(#${gradientId})`} animationDuration={600} />
            </AreaChart>
          </ResponsiveContainer>}
        </div>
        <div className="relative flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-5 py-3 text-[10px] text-slate-500">
          <span>{loading ? 'Reading activity…' : `${activeDays} active days / ${days} days`}</span>
          {!loading && peak?.count > 0 && <span className="inline-flex items-center gap-1"><ArrowUpRight className="h-3 w-3 text-brand-500" />peak {shortDate(peak.date)} ({peak.count})</span>}
          {!loading && trend.current === 0 && <span>No commit activity available</span>}
        </div>
      </>}
    </section>
  )
}
