import { useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { Area, AreaChart, CartesianGrid, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { TrickleProgress } from '@/components/ui/trickle-progress'
import { useContextualActivity } from '@/hooks/useContextualActivity'
import { CHROME, TICK } from '@/lib/chartTheme'
import { ACTIVITY_LEGEND, GOOD_HISTORY_COLOR, MARKER_RING, activityContextColor, contextualizeActivity } from '@/lib/activityContext'
import { BRAND } from '@/lib/theme'
import type { ActivityContextKind, ContextActivityPoint } from '@/types'

/** A day the graph puts a marker on — `kind` is known non-null. */
type MarkedPoint = ContextActivityPoint & { kind: ActivityContextKind }

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
      <div aria-hidden="true" className="h-8 w-8 rounded-full border-2 border-brand-500 border-t-transparent animate-spin motion-reduce:animate-none" />
      <p className="text-sm text-muted-foreground">Loading student activity…</p>
      <TrickleProgress label="Commit activity loading progress" />
    </div>
  )
}

export function ContextualActivityChart({ collectionId, repoId, children, actions, selectedContributorIds = [], expanded = true, onToggle }: {
  collectionId: string
  repoId: string
  children?: ReactNode
  actions?: ReactNode
  selectedContributorIds?: string[]
  /** Whether the graph is showing. State lives on the page, which persists it per repo. */
  expanded?: boolean
  /**
   * Makes the card collapsible. Omitted, the title stays plain text and the
   * graph is always open — which is how this component is rendered in its
   * older tests, and keeps it usable outside RepoDetailPage.
   */
  onToggle?: () => void
}) {
  const { data, isLoading, isError, refetch } = useContextualActivity(collectionId)
  const [range, setRange] = useState('30')
  // Scoped to the repo so two of these on one page could not both claim the
  // same aria-controls target.
  const contentId = `commit-activity-${repoId}`
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
  // `kind` rather than `context`: it is the discriminator the marker colour and
  // the legend both read, and narrowing it here drops a non-null assertion.
  const annotations = points.filter((p): p is MarkedPoint => p.kind !== null)
  const normalPoint = annotations.length === 0 ? points[points.length - 1] : undefined
  return <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
    <Card>
      {/* space-y-1 rather than the card default's 1.5: the pills sit directly
          under the title and read as part of the same block. */}
      <CardHeader className="space-y-1">
        {/* One row — title left, controls right. They were stacked, and since
            the controls were `justify-end` the space beneath the title was
            left blank. */}
        <div
          data-testid="activity-header-row"
          className="flex flex-wrap items-center justify-between gap-2"
        >
          <CardTitle className="text-base">Commit Activity</CardTitle>
          {/* `actions` stays put when collapsed: Check In is not part of the
              graph, and it is the reason most visits to this page happen.
              The chevron is last, so it lands on the card's right edge like
              the one on every SidebarPanel. */}
          <div className="flex flex-wrap items-center gap-2">
            {actions}
            {expanded && (
              <select aria-label="Activity range" value={range} onChange={e => setRange(e.target.value)} className="rounded border bg-background p-2 text-sm">
                <option value="7">7 days</option><option value="30">30 days</option><option value="90">90 days</option><option value="all">All history</option>
              </select>
            )}
            {onToggle && (
              <button
                type="button"
                onClick={onToggle}
                aria-expanded={expanded}
                aria-controls={contentId}
                /* Names the section, not just the gesture: an icon-only
                   control reading "Collapse" tells a screen-reader user
                   nothing about what collapses. */
                aria-label={`${expanded ? 'Collapse' : 'Expand'} Commit Activity`}
                className="rounded p-1 text-muted-foreground hover:text-brand-600 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
              >
                {expanded
                  ? <ChevronUp className="h-4 w-4" />
                  : <ChevronDown className="h-4 w-4" />}
              </button>
            )}
          </div>
        </div>
        {children}
        {/* Explains the markers, so it goes with them. */}
        {expanded && <p className="text-xs text-muted-foreground">UTC daily counts. Hover highlighted points for context. Quiet periods: 3+ days; bursts: 10+ commits and at least 3× the preceding week’s daily average. Comparisons use other readable repositories in this collection with history before the interval. Patterns suggest a check-in, not a conclusion about effort.</p>}
      </CardHeader>
      {/* Unmounted rather than `hidden`, unlike SidebarPanel: recharts
          measures its container, and a hidden chart measures zero and then
          has to re-render on expand anyway. */}
      {expanded && <CardContent id={contentId}>
        {isLoading ? <ChartLoading /> : isError ? <p role="alert">Could not load activity. <button onClick={() => refetch()} className="underline">Retry</button></p> : !repo?.available ? <p>Repository history unavailable. Sync the repository and try again.</p> : !repo.activity.length ? <p>No commit history available.</p> : <>
          {/* Drawn from the last sync's snapshot, not the clone. */}
          {repo.stale && <p className="mb-2 text-xs text-amber-700">Showing the last synced history — the local clone could not be read.</p>}
          <p className="mb-2 text-sm font-medium">{authorLabel} — commits per day</p>
          <div className="h-56" aria-label="Commit activity graph">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={points} margin={{ top: 12, right: 16, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="contextualActivityGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={BRAND.violet} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={BRAND.violet} stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke={CHROME.grid} strokeDasharray="0" />
                <XAxis dataKey="date" tick={TICK} minTickGap={35} axisLine={{ stroke: CHROME.axis }} tickLine={false} />
                <YAxis allowDecimals={false} tick={TICK} axisLine={false} tickLine={false} />
                <Tooltip content={<ActivityTooltip />} />
                {/* Series colour is brand; marker colours stay semantic, since
                    they encode what kind of day it was. */}
                <Area dataKey="count" type="monotone" stroke={BRAND.violet} strokeWidth={2} fill="url(#contextualActivityGradient)" />
                {normalPoint && <ReferenceDot x={normalPoint.date} y={normalPoint.count} r={0} label={{ value: '✓', position: 'top', fill: GOOD_HISTORY_COLOR, fontSize: 20 }} />}
                {annotations.map(p => <ReferenceDot key={p.date} x={p.date} y={p.count} r={6} fill={activityContextColor(p.kind)} stroke={MARKER_RING} strokeWidth={1.5} />)}
              </AreaChart>
            </ResponsiveContainer>
          </div>
          {/* Every kind is listed whether or not it is on the chart today, so
              the legend reads as a key rather than a changing summary. */}
          <ul aria-label="Marker legend" className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
            {ACTIVITY_LEGEND.map(entry => (
                <li key={entry.key} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  {/* Same dark ring the markers wear, so the swatch is the
                      object the graph draws rather than an approximation. */}
                  <span
                    aria-hidden="true"
                    className="h-2.5 w-2.5 shrink-0 rounded-full border"
                    style={{ backgroundColor: entry.color, borderColor: MARKER_RING }}
                  />
                  {entry.label}
                </li>
            ))}
          </ul>
        </>}
      </CardContent>}
    </Card>
  </motion.div>
}
