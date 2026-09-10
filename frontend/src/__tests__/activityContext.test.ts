import { describe, it, expect } from 'vitest'
import { contextualizeActivity } from '@/lib/activityContext'

describe('activity context', () => {
  const days = (counts: number[]) => counts.map((count, i) => ({ date: `2026-09-${String(i + 1).padStart(2, '0')}`, count }))
  it('fills missing days and flags quiet intervals while peers are active', () => {
    const result = contextualizeActivity(days([1]), [days([1, 1, 1, 1])], '2026-09-01', '2026-09-04')
    expect(result.map(p => p.count)).toEqual([1, 0, 0, 0])
    expect(result[3].context).toContain('Potential issue')
    expect(result[3].context).toContain('1 of 1')
  })
  it('recognizes shared quiet intervals', () => {
    expect(contextualizeActivity(days([1]), [days([1])], '2026-09-01', '2026-09-04')[3].context).toContain('also quiet')
  })
  it('does not equate missing history with inactivity', () => {
    expect(contextualizeActivity(days([1]), [[]], '2026-09-01', '2026-09-04')[3].context).toContain('unavailable')
  })
  it('flags inconsistent bursts against prior days', () => {
    const result = contextualizeActivity(days([1, 1, 1, 1, 1, 1, 1, 20]), [], '2026-09-01', '2026-09-08')
    expect(result[7].context).toContain('Unusual burst')
    expect(result[7].context).toContain('20 commits')
  })
  it('does not flag steady activity or first-day bursts without a baseline', () => {
    expect(contextualizeActivity(days([10, 10, 10, 10]), [], '2026-09-01', '2026-09-04').every(p => !p.context)).toBe(true)
  })
})
