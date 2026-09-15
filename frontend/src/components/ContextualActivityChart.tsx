import { useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { Area, AreaChart, CartesianGrid, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { TrickleProgress } from '@/components/ui/trickle-progress'
import { useContextualActivity } from '@/hooks/useContextualActivity'
import { contextualizeActivity } from '@/lib/activityContext'
import type { ContextActivityPoint } from '@/types'

function ActivityTooltip({ active, payload }: { active?: boolean; payload?: { payload?: ContextActivityPoint }[] }) {
  const point = payload?.[0]?.payload
  if (!active || !point) return null
  return <div className="max-w-xs rounded border bg-background p-3 text-sm shadow-md"><p className="font-medium">{point.date}: {point.count} commits</p>{point.context && <p>{point.context}</p>}</div>
}

/** Occupies the same h-56 the chart will, so the card doesn't collapse and
 *  then jump when the data lands. */
function ChartLoading() {
  return (
    <div role="status" aria-label="Loading commit activity graph" className="flex h-56 flex-col items-center justify-center gap-3">
      <div aria-hidden="true" className="h-8 w-8 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin motion-reduce:animate-none" />
      <p className="text-sm text-muted-foreground">Loading student activity…</p>
      <TrickleProgress label="Commit activity loading progress" />
    </div>
  )
}

export function ContextualActivityChart({ collectionId, repoId, children, actions, selectedContributorIds = [] }: { collectionId: string; repoId: string; children?: ReactNode; actions?: ReactNode; selectedContributorIds?: string[] }) {
  const { data, isLoading, isError, refetch } = useContextualActivity(collectionId)
  const [range, setRange] = useState('30')
  const repo = data?.repositories.find(r => r.id === repoId)
  const students = repo?.students.filter(s => selectedContributorIds.includes(s.id)) ?? []
  const allSelected = !selectedContributorIds.length || (Boolean(repo?.students.length) && students.length === repo?.students.length)
  const counts = new Map<string, number>()
  students.forEach(student => student.activity.forEach(p => counts.set(p.date, (counts.get(p.date) ?? 0) + p.count)))
  const activity = allSelected ? repo?.activity ?? [] : Array.from(counts, ([date, count]) => ({ date, count }))
  const authorLabel = allSelected ? 'All students' : students.map(s => s.name).join(', ') || 'Selected students'
  const today = new Date().toISOString().slice(0, 10)
  const start = range === 'all' ? repo?.activity[0]?.date ?? today : new Date(Date.parse(today) - (Number(range) - 1) * 86400000).toISOString().slice(0, 10)
  // Analyze full history before slicing so range changes do not erase the baseline.
  const historyStart = repo?.activity[0]?.date ?? start
  const peers = data?.repositories.filter(r => r.id !== repoId && r.available).map(r => r.activity) ?? []
  const points = contextualizeActivity(activity, peers, historyStart, today).filter(p => p.date >= start)
  const annotations = points.filter(p => p.context)
  const normalPoint = annotations.length === 0 ? points[points.length - 1] : undefined
  return <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Commit Activity</CardTitle>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {actions}
          <select aria-label="Activity range" value={range} onChange={e => setRange(e.target.value)} className="rounded border bg-background p-2 text-sm">
            <option value="7">7 days</option><option value="30">30 days</option><option value="90">90 days</option><option value="all">All history</option>
          </select>
        </div>
        {children}
        <p className="text-xs text-muted-foreground">UTC daily counts. Hover highlighted points for context. Quiet periods: 3+ days; bursts: 10+ commits and at least 3× the preceding week’s daily average. Comparisons use other readable repositories in this collection with history before the interval. Patterns suggest a check-in, not a conclusion about effort.</p>
      </CardHeader>
      <CardContent>
        {isLoading ? <ChartLoading /> : isError ? <p role="alert">Could not load activity. <button onClick={() => refetch()} className="underline">Retry</button></p> : !repo?.available ? <p>Repository history unavailable. Sync the repository and try again.</p> : !repo.activity.length ? <p>No commit history available.</p> : <>
          {/* Drawn from the last sync's snapshot, not the clone. */}
          {repo.stale && <p className="mb-2 text-xs text-amber-700">Showing the last synced history — the local clone could not be read.</p>}
          <p className="mb-2 text-sm font-medium">{authorLabel} — commits per day</p>
          <div className="h-56" aria-label="Commit activity graph">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={points} margin={{ top: 12, right: 16, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="contextualActivityGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} minTickGap={35} />
                <YAxis allowDecimals={false} />
                <Tooltip content={<ActivityTooltip />} />
                <Area dataKey="count" type="monotone" stroke="#6366f1" strokeWidth={2} fill="url(#contextualActivityGradient)" />
                {normalPoint && <ReferenceDot x={normalPoint.date} y={normalPoint.count} r={0} label={{ value: '✓', position: 'top', fill: '#16a34a', fontSize: 20 }} />}
                {annotations.map(p => <ReferenceDot key={p.date} x={p.date} y={p.count} r={6} fill="#d97706" stroke="#fff" />)}
              </AreaChart>
            </ResponsiveContainer>
          </div>
          {annotations.length > 0 && <div className="mt-3 max-h-48 space-y-2 overflow-auto" aria-label="Significant activity periods">
            {annotations.map(p => <details key={p.date} className="rounded border p-2 text-sm"><summary className="cursor-pointer font-medium">{p.date} — {p.count ? 'Unusual burst' : 'Quiet period'}</summary><p className="mt-2">{p.context}</p></details>)}
          </div>}
        </>}
      </CardContent>
    </Card>
  </motion.div>
}
