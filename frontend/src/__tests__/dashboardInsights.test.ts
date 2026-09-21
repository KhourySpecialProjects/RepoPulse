import { describe, it, expect } from 'vitest'
import {
  mergeDailyActivity,
  activityTrend,
  healthMix,
  averageHealthSignals,
  stalenessBuckets,
  buildInsights,
} from '@/lib/dashboardInsights'
import { HEALTH_STATUS_LABELS, HEALTH_STATUS_ORDER } from '@/components/HealthBadge'
import type { HealthScore, Repo } from '@/types'

const TODAY = new Date('2026-09-15T12:00:00Z')

function repo(over: Partial<Repo> = {}): Repo {
  return {
    id: over.id ?? 'repo-1',
    collection_id: 'col-1',
    github_url: 'https://github.com/x/y',
    name: over.name ?? 'y',
    local_path: '/repos/y',
    health_status: 'green',
    health_score: null,
    last_synced_at: null,
    last_commit_at: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    contributor_count: 3,
    active_reminder_count: 0,
    expected_contributor_count: null,
    sync_status: 'idle',
    sync_started_at: null,
    sync_started_by_name: null,
    sync_error: null,
    ...over,
  }
}

function score(over: Partial<HealthScore> = {}): HealthScore {
  return {
    commit_frequency: 2,
    recency: 2,
    distribution: 2,
    branch_activity: 2,
    commit_message_quality: 2,
    participation: 2,
    composite: 1,
    status: 'green',
    ...over,
  }
}

describe('mergeDailyActivity', () => {
  it('sums the same day across collections', () => {
    const merged = mergeDailyActivity(
      [
        [{ date: '2026-09-15', count: 3 }],
        [{ date: '2026-09-15', count: 4 }],
      ],
      3,
      TODAY
    )

    expect(merged[merged.length - 1]).toEqual({ date: '2026-09-15', count: 7 })
  })

  it('returns one point per day and fills the quiet days with zero', () => {
    const merged = mergeDailyActivity([[{ date: '2026-09-15', count: 1 }]], 5, TODAY)

    expect(merged).toHaveLength(5)
    expect(merged.map(p => p.date)).toEqual([
      '2026-09-11',
      '2026-09-12',
      '2026-09-13',
      '2026-09-14',
      '2026-09-15',
    ])
    expect(merged.slice(0, 4).every(p => p.count === 0)).toBe(true)
  })

  it('drops days outside the window rather than compressing them in', () => {
    const merged = mergeDailyActivity(
      [
        [
          { date: '2026-01-01', count: 99 },
          { date: '2026-09-14', count: 2 },
        ],
      ],
      3,
      TODAY
    )

    expect(merged.reduce((sum, p) => sum + p.count, 0)).toBe(2)
  })
})

describe('activityTrend', () => {
  it('compares the window against the window before it', () => {
    const series = [
      [
        { date: '2026-09-15', count: 6 }, // inside the last 3 days
        { date: '2026-09-14', count: 6 },
        { date: '2026-09-11', count: 4 }, // inside the 3 days before that
        { date: '2026-09-10', count: 2 },
      ],
    ]

    expect(activityTrend(series, 3, TODAY)).toEqual({
      current: 12,
      previous: 6,
      deltaPct: 100,
    })
  })

  it('reports a drop as a negative delta', () => {
    const series = [[{ date: '2026-09-15', count: 5 }, { date: '2026-09-11', count: 10 }]]

    expect(activityTrend(series, 3, TODAY).deltaPct).toBe(-50)
  })

  // Dividing by an empty previous window yields Infinity, which is not a
  // percentage anyone can read, so the caller is told there is no baseline.
  it('has no percentage to report when the previous window was empty', () => {
    const series = [[{ date: '2026-09-15', count: 5 }]]

    expect(activityTrend(series, 3, TODAY)).toEqual({
      current: 5,
      previous: 0,
      deltaPct: null,
    })
  })
})

describe('healthMix', () => {
  it('counts every status, including the ones at zero', () => {
    const mix = healthMix([
      repo({ id: 'a', health_status: 'green' }),
      repo({ id: 'b', health_status: 'green' }),
      repo({ id: 'c', health_status: 'red' }),
    ])

    expect(mix).toEqual([
      { status: 'green', label: 'Healthy', count: 2 },
      { status: 'yellow', label: 'At Risk', count: 0 },
      { status: 'red', label: 'Critical', count: 1 },
      { status: 'unknown', label: 'Unknown', count: 0 },
    ])
  })
})

describe('averageHealthSignals', () => {
  it('averages each signal across the repos that have a score', () => {
    const signals = averageHealthSignals([
      repo({ id: 'a', health_score: score({ distribution: 0 }) }),
      repo({ id: 'b', health_score: score({ distribution: 1 }) }),
      repo({ id: 'c', health_score: null }),
    ])

    expect(signals.find(s => s.key === 'distribution')?.value).toBe(25)
    expect(signals.find(s => s.key === 'recency')?.value).toBe(100)
  })

  it('reports the average out of 100, not on the backend 0-2 scale', () => {
    // The backend grades each signal 0, 1 or 2. That scale is an internal
    // detail; everything user-facing is a score out of 100, matching the
    // composite badge.
    const signals = averageHealthSignals([repo({ health_score: score({ recency: 1 }) })])

    expect(signals.find(s => s.key === 'recency')?.value).toBe(50)
    expect(signals.every(s => s.value >= 0 && s.value <= 100)).toBe(true)
  })

  it('rounds to a whole score rather than a long fraction', () => {
    const signals = averageHealthSignals([
      repo({ id: 'a', health_score: score({ distribution: 0 }) }),
      repo({ id: 'b', health_score: score({ distribution: 0 }) }),
      repo({ id: 'c', health_score: score({ distribution: 1 }) }),
    ])

    // (0 + 0 + 1) / 3 = 0.333 of 2 = 16.67 → 17
    expect(signals.find(s => s.key === 'distribution')?.value).toBe(17)
  })

  it('treats a missing participation score as zero, matching the pills', () => {
    const signals = averageHealthSignals([
      repo({ id: 'a', health_score: score({ participation: null }) }),
    ])

    expect(signals.find(s => s.key === 'participation')?.value).toBe(0)
  })

  it('returns nothing to plot when no repo has been scored', () => {
    expect(averageHealthSignals([repo({ health_score: null })])).toEqual([])
  })
})

describe('stalenessBuckets', () => {
  it('buckets repos by how long they have been quiet', () => {
    const buckets = stalenessBuckets(
      [
        repo({ id: 'a', last_commit_at: '2026-09-15T08:00:00Z' }),
        repo({ id: 'b', last_commit_at: '2026-09-12T08:00:00Z' }),
        repo({ id: 'c', last_commit_at: '2026-09-05T08:00:00Z' }),
        repo({ id: 'd', last_commit_at: '2026-06-01T08:00:00Z' }),
        repo({ id: 'e', last_commit_at: null }),
      ],
      TODAY
    )

    expect(buckets).toEqual([
      { label: 'Today', count: 1 },
      { label: '1–7 days', count: 1 },
      { label: '8–14 days', count: 1 },
      { label: '15+ days', count: 1 },
      { label: 'Never', count: 1 },
    ])
  })
})

describe('buildInsights', () => {
  const trendUp = { current: 40, previous: 20, deltaPct: 100 }
  const flat = { current: 0, previous: 0, deltaPct: null }

  it('leads with the most severe finding', () => {
    const insights = buildInsights({
      repos: [
        repo({ id: 'a', last_commit_at: '2026-06-01T00:00:00Z' }),
        repo({ id: 'b', last_commit_at: '2026-06-01T00:00:00Z' }),
      ],
      trend: trendUp,
      signals: averageHealthSignals([repo({ health_score: score() })]),
      today: TODAY,
    })

    expect(insights[0].tone).toBe('bad')
    expect(insights[0].text).toMatch(/2 repositories/)
  })

  it('calls out the weakest signal by name', () => {
    const insights = buildInsights({
      repos: [repo({ health_score: score({ distribution: 0 }) })],
      trend: flat,
      signals: averageHealthSignals([repo({ health_score: score({ distribution: 0 }) })]),
      today: TODAY,
    })

    expect(insights.some(i => /Distribution/.test(i.text))).toBe(true)
  })

  it('reads a rise in commit volume as good news', () => {
    const insights = buildInsights({
      repos: [repo({ last_commit_at: '2026-09-15T00:00:00Z' })],
      trend: trendUp,
      signals: [],
      today: TODAY,
    })

    const volume = insights.find(i => /100%/.test(i.text))
    expect(volume?.tone).toBe('good')
    expect(volume?.text).toMatch(/up 100%/)
  })

  it('flags repositories carrying the work alone', () => {
    const insights = buildInsights({
      repos: [
        repo({ id: 'a', contributor_count: 1, last_commit_at: '2026-09-15T00:00:00Z' }),
        repo({ id: 'b', contributor_count: 4, last_commit_at: '2026-09-15T00:00:00Z' }),
      ],
      trend: flat,
      signals: [],
      today: TODAY,
    })

    expect(insights.some(i => /single contributor/.test(i.text))).toBe(true)
  })

  it('says so plainly when there is nothing to report', () => {
    expect(buildInsights({ repos: [], trend: flat, signals: [], today: TODAY })).toEqual([])
  })

  it('never floods the strip', () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      repo({ id: `r${i}`, contributor_count: 1, last_commit_at: '2026-01-01T00:00:00Z' })
    )

    expect(
      buildInsights({ repos: many, trend: trendUp, signals: [], today: TODAY }).length
    ).toBeLessThanOrEqual(4)
  })
})

// A legend that says "At risk" next to badges that say "At Risk" looks like
// two different things, so both read from one map.
describe('health status labels', () => {
  it('uses the same words and order as the badges', () => {
    expect(healthMix([]).map(slice => slice.status)).toEqual([...HEALTH_STATUS_ORDER])
    expect(healthMix([]).map(slice => slice.label)).toEqual(
      HEALTH_STATUS_ORDER.map(status => HEALTH_STATUS_LABELS[status])
    )
  })
})
