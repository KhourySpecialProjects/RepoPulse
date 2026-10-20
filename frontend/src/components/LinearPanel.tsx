import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Link2, ListChecks, Pencil, RefreshCw, TriangleAlert } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ChartTableView, StackedShareBar, type ShareSegment } from '@/components/charts'
import { linearErrorCode, useLinearTeams, useLinkLinearTeam, useRepoLinear } from '@/hooks/useLinear'
import { CHROME, MARKS, ORDINAL, SERIES, TICK } from '@/lib/chartTheme'
import type { LinearCycleProgress, LinearTeamStats, LinearWeeklyCompletion, RepoLinear } from '@/types'

/**
 * Linear stats for the repo's team, beside the Commits card on Repo Detail.
 *
 * Read live with the *viewer's* Linear key, so two people can see different
 * states for the same repo: one with no key sees the Settings prompt while the
 * owner sees stats. Which team is shown is decided server-side — the picked
 * team, else a match on the repo name.
 */
export function LinearPanel({ repoId }: { repoId: string }) {
  const { data, isLoading, error, refetch, isFetching } = useRepoLinear(repoId)
  const [picking, setPicking] = useState(false)

  return (
    <Card data-testid="linear-panel">
      <CardHeader className="p-4 pb-2 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base flex items-center gap-2">
          <ListChecks className="h-4 w-4 text-muted-foreground" />
          Linear
        </CardTitle>
        {data?.status === 'ok' && data.can_change_team && !picking && (
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setPicking(true)}>
            <Pencil className="h-3.5 w-3.5" />
            Change team
          </Button>
        )}
      </CardHeader>
      <CardContent className="p-4 pt-0 flex flex-col gap-4">
        {picking && data && (
          <TeamPicker repoId={repoId} current={data} onDone={() => setPicking(false)} />
        )}
        {isLoading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <RefreshCw className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
            Loading Linear…
          </p>
        ) : error ? (
          <LinearError error={error} onRetry={() => refetch()} retrying={isFetching} />
        ) : data?.status === 'not_configured' ? (
          <Placeholder>
            Connect Linear to see this team&apos;s issues here.{' '}
            <Link to="/settings" className="text-brand-600 hover:underline">
              Add your Linear API key in Settings
            </Link>
          </Placeholder>
        ) : data?.status === 'no_team' ? (
          <>
            <Placeholder>
              <span className="text-sm font-medium text-muted-foreground">Linear info soon</span>
            </Placeholder>
            {data.matched_by === 'manual' && (
              <p className="text-xs text-muted-foreground">
                The linked team isn&apos;t visible with your Linear key.
              </p>
            )}
            {data.can_change_team && !picking && (
              <Button size="sm" variant="outline" className="gap-1.5 self-start" onClick={() => setPicking(true)}>
                <Link2 className="h-3.5 w-3.5" />
                Link a Linear team
              </Button>
            )}
          </>
        ) : data?.status === 'ok' && data.team && data.stats ? (
          <>
            <div className="flex flex-wrap items-center gap-2 min-w-0">
              <span className="font-medium truncate">{data.team.name}</span>
              <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{data.team.key}</span>
              <span className="text-xs text-muted-foreground">
                {data.matched_by === 'manual' ? 'Linked' : 'Matched by repo name'}
              </span>
            </div>
            <TeamStats stats={data.stats} />
          </>
        ) : null}
      </CardContent>
    </Card>
  )
}

function Placeholder({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-[8rem] items-center justify-center rounded-lg border border-dashed border-border px-4 text-center text-sm text-muted-foreground">
      <p>{children}</p>
    </div>
  )
}

function LinearError({ error, onRetry, retrying }: { error: unknown; onRetry: () => void; retrying: boolean }) {
  if (linearErrorCode(error) === 'linear_key_invalid') {
    return (
      <p className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
        <TriangleAlert className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
        <span>
          Linear rejected your API key.{' '}
          <Link to="/settings" className="font-medium underline">
            Update it in Settings
          </Link>
        </span>
      </p>
    )
  }
  return (
    <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
      <span>Couldn&apos;t load Linear right now.</span>
      <Button size="sm" variant="outline" loading={retrying} onClick={onRetry}>
        Retry
      </Button>
    </div>
  )
}

function TeamPicker({ repoId, current, onDone }: { repoId: string; current: RepoLinear; onDone: () => void }) {
  const { data: teams, isLoading, isError } = useLinearTeams(true)
  const link = useLinkLinearTeam(repoId)
  // '' is "auto-detect": an auto-matched team is not a choice anyone made.
  const value = current.matched_by === 'manual' ? current.team?.id ?? '' : ''

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-3">
      {isLoading ? (
        <p className="text-xs text-muted-foreground">Loading teams…</p>
      ) : isError ? (
        <p className="text-xs text-muted-foreground">Couldn&apos;t load your Linear teams.</p>
      ) : (
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Linear team
          <select
            aria-label="Linear team"
            className="h-8 rounded-md border border-border bg-background px-2 text-sm text-foreground"
            value={value}
            disabled={link.isPending}
            onChange={async event => {
              try {
                await link.mutateAsync(event.target.value || null)
                onDone()
              } catch {
                toast.error('Failed to change the Linear team')
              }
            }}
          >
            <option value="">Auto-detect from repo name</option>
            {teams?.items.map(team => (
              <option key={team.id} value={team.id}>
                {team.name} ({team.key})
              </option>
            ))}
          </select>
        </label>
      )}
      <Button size="sm" variant="ghost" className="self-end" onClick={onDone}>
        Cancel
      </Button>
    </div>
  )
}

// Workflow stages are ordered, so they take the ordinal ramp — light for
// not-yet-started through dark for done. Canceled sits outside the order and
// is the de-emphasis grey.
const STATUS_SEGMENTS: Array<{ key: keyof LinearTeamStats['status_counts']; label: string; color: string }> = [
  { key: 'triage', label: 'Triage', color: ORDINAL[0] },
  { key: 'backlog', label: 'Backlog', color: ORDINAL[1] },
  { key: 'unstarted', label: 'Todo', color: ORDINAL[2] },
  { key: 'started', label: 'In Progress', color: ORDINAL[3] },
  { key: 'completed', label: 'Done', color: ORDINAL[4] },
  { key: 'canceled', label: 'Canceled', color: CHROME.deemphasis },
]

function TeamStats({ stats }: { stats: LinearTeamStats }) {
  const segments: ShareSegment[] = STATUS_SEGMENTS.map(s => ({ ...s, value: stats.status_counts[s.key] }))

  return (
    <>
      <section>
        <SectionHeading>Issues</SectionHeading>
        <StackedShareBar segments={segments} testIdPrefix="linear-status" emptyMessage="No issues in this team yet." />
      </section>

      <section className="border-t border-border pt-3">
        <SectionHeading>Current cycle</SectionHeading>
        {stats.active_cycle ? (
          <CycleProgress cycle={stats.active_cycle} />
        ) : (
          <p className="text-sm text-muted-foreground">No active cycle.</p>
        )}
      </section>

      <section className="border-t border-border pt-3">
        <WeeklyCompletions weeks={stats.completed_per_week} />
      </section>

      <section className="border-t border-border pt-3">
        <SectionHeading>By member</SectionHeading>
        {stats.members.length ? (
          <ChartTableView
            caption="Issues per member"
            columns={['Member', 'Open', 'Done']}
            rows={stats.members.map(m => [m.name, m.open, m.completed])}
          />
        ) : (
          <p className="text-sm text-muted-foreground">No issues yet.</p>
        )}
      </section>
    </>
  )
}

function SectionHeading({ children }: { children: ReactNode }) {
  return <h4 className="mb-2 text-xs font-medium text-muted-foreground">{children}</h4>
}

function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** A YYYY-MM-DD week start as "Oct 19", read as a local date so it cannot shift a day. */
function formatWeek(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function CycleProgress({ cycle }: { cycle: LinearCycleProgress }) {
  const percent = Math.round(Math.min(Math.max(cycle.progress, 0), 1) * 100)
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="min-w-0 truncate">
          <span className="font-medium">Cycle {cycle.number}</span>
          {cycle.name && <span className="text-muted-foreground"> · {cycle.name}</span>}
        </span>
        <span className="font-semibold tabular-nums">{percent}%</span>
      </div>
      <div
        role="progressbar"
        aria-label="Cycle progress"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
      >
        {/* Inline width, as in the chart primitives: it is data, not style. */}
        <div className="h-full rounded-full bg-brand-600 transition-[width] duration-500" style={{ width: `${percent}%` }} />
      </div>
      <div className="flex justify-between gap-2 text-xs text-muted-foreground">
        <span>{cycle.completed_issue_count} of {cycle.issue_count} issues done</span>
        <span>{formatShortDate(cycle.starts_at)} – {formatShortDate(cycle.ends_at)}</span>
      </div>
    </div>
  )
}

function WeeklyCompletions({ weeks }: { weeks: LinearWeeklyCompletion[] }) {
  const [showTable, setShowTable] = useState(false)
  const data = weeks.map(w => ({ label: formatWeek(w.week_start), completed: w.completed }))
  const anyCompleted = weeks.some(w => w.completed > 0)

  return (
    <>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="text-xs font-medium text-muted-foreground">Completed per week</h4>
        {anyCompleted && (
          <button
            type="button"
            onClick={() => setShowTable(v => !v)}
            aria-pressed={showTable}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            {showTable ? 'Show chart' : 'Show table'}
          </button>
        )}
      </div>
      {!anyCompleted ? (
        <p className="text-sm text-muted-foreground">No issues completed in the last {weeks.length} weeks.</p>
      ) : showTable ? (
        <ChartTableView
          caption="Issues completed per week"
          columns={['Week of', 'Completed']}
          rows={data.map(d => [d.label, d.completed])}
        />
      ) : (
        <div className="h-28" data-testid="linear-weekly-chart">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
              <CartesianGrid vertical={false} stroke={CHROME.grid} strokeDasharray="0" />
              <XAxis dataKey="label" tick={TICK} axisLine={{ stroke: CHROME.axis }} tickLine={false} interval={0} />
              <YAxis tick={TICK} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip
                cursor={{ fill: CHROME.grid, fillOpacity: 0.4 }}
                content={({ active, payload }) =>
                  active && payload?.length ? (
                    <div className="rounded-md border border-border bg-card px-2.5 py-1.5 text-xs shadow-md">
                      <span className="font-semibold tabular-nums">{payload[0].payload.completed}</span>{' '}
                      <span className="text-muted-foreground">completed · week of {payload[0].payload.label}</span>
                    </div>
                  ) : null
                }
              />
              <Bar
                dataKey="completed"
                fill={SERIES[0]}
                maxBarSize={MARKS.barSize}
                radius={[MARKS.barRadius, MARKS.barRadius, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </>
  )
}
