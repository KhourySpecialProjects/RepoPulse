import { HEALTH_STATUS_LABELS, HEALTH_STATUS_ORDER } from '@/components/HealthBadge'
import type { CommitActivityPoint, HealthScore, HealthStatus, Repo } from '@/types'

/**
 * Everything the dashboard shows beyond raw counts is derived here rather than
 * in the page, so the arithmetic can be tested without rendering a chart.
 */

const DAY_MS = 86_400_000

/** UTC day key, matching the `YYYY-MM-DD` the activity endpoint returns. */
function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function daysAgo(from: Date, days: number): Date {
  return new Date(from.getTime() - days * DAY_MS)
}

/**
 * One point per day for the last `days`, summed across every collection.
 *
 * Recharts draws whatever it is handed, so the quiet days have to be present
 * as zeroes — otherwise a fortnight of silence renders as a straight line
 * between two spikes and reads as steady activity.
 */
export function mergeDailyActivity(
  series: CommitActivityPoint[][],
  days: number,
  today: Date = new Date()
): CommitActivityPoint[] {
  const totals = new Map<string, number>()
  for (const points of series) {
    for (const point of points) {
      totals.set(point.date, (totals.get(point.date) ?? 0) + point.count)
    }
  }

  return Array.from({ length: days }, (_, index) => {
    const date = dayKey(daysAgo(today, days - 1 - index))
    return { date, count: totals.get(date) ?? 0 }
  })
}

export interface ActivityTrend {
  current: number
  previous: number
  /** Percent change, rounded. `null` when the previous window had no commits. */
  deltaPct: number | null
}

/** The last `days` against the `days` immediately before them. */
export function activityTrend(
  series: CommitActivityPoint[][],
  days: number,
  today: Date = new Date()
): ActivityTrend {
  const current = mergeDailyActivity(series, days, today).reduce((sum, p) => sum + p.count, 0)
  const total = mergeDailyActivity(series, days * 2, today).reduce((sum, p) => sum + p.count, 0)
  const previous = total - current

  return {
    current,
    previous,
    deltaPct: previous === 0 ? null : Math.round(((current - previous) / previous) * 100),
  }
}

export interface HealthSlice {
  status: HealthStatus
  label: string
  count: number
}

/** Every status, including empty ones, so the legend never reshuffles. */
export function healthMix(repos: Repo[]): HealthSlice[] {
  return HEALTH_STATUS_ORDER.map(status => ({
    status,
    label: HEALTH_STATUS_LABELS[status],
    count: repos.filter(repo => repo.health_status === status).length,
  }))
}

/** The six signals the backend scores, each 0–2. */
type SignalKey =
  | 'commit_frequency'
  | 'recency'
  | 'distribution'
  | 'branch_activity'
  | 'commit_message_quality'
  | 'participation'

const SIGNALS: ReadonlyArray<readonly [SignalKey, string]> = [
  ['commit_frequency', 'Frequency'],
  ['recency', 'Recency'],
  ['distribution', 'Distribution'],
  ['branch_activity', 'Branches'],
  ['commit_message_quality', 'Msg Quality'],
  ['participation', 'Participation'],
]

export interface SignalAverage {
  key: SignalKey
  label: string
  /** 0–2, on the same scale the health pills use. */
  value: number
}

/**
 * The cohort's average per signal, which is what turns six per-repo numbers
 * into one readable answer: where is the class as a whole weak?
 */
export function averageHealthSignals(repos: Repo[]): SignalAverage[] {
  const scores = repos
    .map(repo => repo.health_score)
    .filter((score): score is HealthScore => score !== null && score !== undefined)
  if (scores.length === 0) return []

  return SIGNALS.map(([key, label]) => ({
    key,
    label,
    // Participation is the one nullable signal; the pills count an absent
    // expectation as zero, so this has to agree with them.
    value:
      Math.round(
        (scores.reduce((sum, score) => sum + (score[key] ?? 0), 0) / scores.length) * 100
      ) / 100,
  }))
}

export interface StalenessBucket {
  label: string
  count: number
}

const STALENESS_BUCKETS: ReadonlyArray<readonly [string, number]> = [
  ['Today', 0],
  ['1–7 days', 7],
  ['8–14 days', 14],
  ['15+ days', Infinity],
]

function wholeDaysSince(iso: string, today: Date): number {
  return Math.floor((today.getTime() - Date.parse(iso)) / DAY_MS)
}

/** How long since each repo last saw a commit, as a distribution. */
export function stalenessBuckets(repos: Repo[], today: Date = new Date()): StalenessBucket[] {
  const buckets = STALENESS_BUCKETS.map(([label]) => ({ label, count: 0 }))
  let never = 0

  for (const repo of repos) {
    if (!repo.last_commit_at) {
      never += 1
      continue
    }
    const age = wholeDaysSince(repo.last_commit_at, today)
    const index = STALENESS_BUCKETS.findIndex(([, max]) => age <= max)
    buckets[index === -1 ? buckets.length - 1 : index].count += 1
  }

  return [...buckets, { label: 'Never', count: never }]
}

export type InsightTone = 'good' | 'warn' | 'bad' | 'neutral'

export interface Insight {
  id: string
  tone: InsightTone
  text: string
}

const TONE_RANK: Record<InsightTone, number> = { bad: 0, warn: 1, good: 2, neutral: 3 }

/** Below this, on the 0–2 signal scale, a signal is worth naming. */
const WEAK_SIGNAL = 1.2
const SILENT_DAYS = 14
const MAX_INSIGHTS = 4

function repoCount(n: number): string {
  return `${n} ${n === 1 ? 'repository' : 'repositories'}`
}

/**
 * The findings worth reading out loud, most severe first and capped so the
 * strip stays skimmable. A dashboard that lists twelve equally-weighted
 * observations is just another table.
 */
export function buildInsights({
  repos,
  trend,
  signals,
  today = new Date(),
}: {
  repos: Repo[]
  trend: ActivityTrend
  signals: SignalAverage[]
  today?: Date
}): Insight[] {
  if (repos.length === 0) return []

  const found: Insight[] = []

  const silent = repos.filter(
    repo => !repo.last_commit_at || wholeDaysSince(repo.last_commit_at, today) >= SILENT_DAYS
  )
  if (silent.length > 0) {
    found.push({
      id: 'silent',
      tone: 'bad',
      text: `${repoCount(silent.length)} ${
        silent.length === 1 ? 'has' : 'have'
      } had no commits in ${SILENT_DAYS} days.`,
    })
  }

  const weakest = [...signals].sort((a, b) => a.value - b.value)[0]
  if (weakest && weakest.value < WEAK_SIGNAL) {
    found.push({
      id: 'weak-signal',
      tone: weakest.value < 0.8 ? 'bad' : 'warn',
      text: `${weakest.label} is the weakest health signal across the workspace, averaging ${weakest.value.toFixed(
        1
      )} of 2.`,
    })
  }

  const solo = repos.filter(repo => repo.contributor_count === 1)
  if (solo.length > 0) {
    found.push({
      id: 'solo',
      tone: 'warn',
      text: `${repoCount(solo.length)} ${
        solo.length === 1 ? 'is' : 'are'
      } running on a single contributor.`,
    })
  }

  const short = repos.filter(
    repo =>
      repo.expected_contributor_count !== null &&
      repo.contributor_count < repo.expected_contributor_count
  )
  if (short.length > 0) {
    found.push({
      id: 'below-expected',
      tone: 'warn',
      text: `${repoCount(short.length)} ${
        short.length === 1 ? 'has' : 'have'
      } fewer contributors than expected.`,
    })
  }

  if (trend.deltaPct !== null && Math.abs(trend.deltaPct) >= 10) {
    const rising = trend.deltaPct > 0
    found.push({
      id: 'volume',
      tone: rising ? 'good' : 'warn',
      text: `Commit volume is ${rising ? 'up' : 'down'} ${Math.abs(
        trend.deltaPct
      )}% on the previous period.`,
    })
  }

  const strongest = [...signals].sort((a, b) => b.value - a.value)[0]
  if (strongest && strongest.value >= 1.6) {
    found.push({
      id: 'strong-signal',
      tone: 'good',
      text: `${strongest.label} is the workspace's strongest signal, averaging ${strongest.value.toFixed(
        1
      )} of 2.`,
    })
  }

  return found
    .sort((a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone])
    .slice(0, MAX_INSIGHTS)
}
