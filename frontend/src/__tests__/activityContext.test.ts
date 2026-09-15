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

describe('context kind', () => {
  const days = (counts: number[]) => counts.map((count, i) => ({ date: `2026-09-${String(i + 1).padStart(2, '0')}`, count }))

  it('marks every quiet stretch with one kind, whatever the peers did', () => {
    // The peers-active nuance stays in the context text; the marker does not
    // fork on it, so all three of these are the same kind.
    const peersActive = contextualizeActivity(days([1]), [days([1, 1, 1, 1])], '2026-09-01', '2026-09-04')
    const sharedPause = contextualizeActivity(days([1]), [days([1])], '2026-09-01', '2026-09-04')
    const noPeers = contextualizeActivity(days([1]), [[]], '2026-09-01', '2026-09-04')

    expect(peersActive[3].kind).toBe('quiet')
    expect(sharedPause[3].kind).toBe('quiet')
    expect(noPeers[3].kind).toBe('quiet')
    // Still distinguishable where it matters — in the text the tooltip shows.
    expect(peersActive[3].context).toContain('Potential issue')
    expect(sharedPause[3].context).toContain('also quiet')
  })

  it('separates a late burst carrying most of the project from routine batching', () => {
    // Same spike, different position in the window: on the last day and holding
    // 30 of 31 commits it is a deadline push; with a week still to run it is not.
    const deadline = contextualizeActivity(
      [{ date: '2026-09-01', count: 1 }, { date: '2026-09-08', count: 30 }], [], '2026-09-01', '2026-09-09')
    expect(deadline[7].kind).toBe('burst-deadline')

    const batched = contextualizeActivity(
      [{ date: '2026-09-01', count: 1 }, { date: '2026-09-08', count: 30 }], [], '2026-09-01', '2026-09-15')
    expect(batched[7].kind).toBe('burst-unusual')
  })

  it('treats an ordinary burst as the unusual-burst kind', () => {
    const result = contextualizeActivity(days([1, 1, 1, 1, 1, 1, 1, 20]), [], '2026-09-01', '2026-09-08')
    expect(result[7].kind).toBe('burst-unusual')
  })

  it('leaves unremarkable days unmarked', () => {
    const result = contextualizeActivity(days([10, 10, 10, 10]), [], '2026-09-01', '2026-09-04')
    expect(result.every(p => p.kind === null)).toBe(true)
  })

  it('gives every day with a context a kind, and every kind a context', () => {
    const result = contextualizeActivity(days([1, 1, 1, 1, 1, 1, 1, 20]), [days([1])], '2026-09-01', '2026-09-12')
    result.forEach(p => expect(Boolean(p.context)).toBe(p.kind !== null))
  })
})

it('keeps quiet explanations short without date spans', () => {
  const result = contextualizeActivity([{ date: '2026-09-01', count: 1 }], [], '2026-09-01', '2026-09-05')
  expect(result[4].context).toBe('4 days without commits. Peer comparison unavailable.')
})
it('chooses only deadline wording for a concentrated final burst', () => {
  const result = contextualizeActivity([{ date: '2026-09-01', count: 1 }, { date: '2026-09-08', count: 30 }], [], '2026-09-01', '2026-09-09')
  expect(result[7].context).toBe('Unusual burst of 30 commits. This may reflect a deadline push.')
})
it('chooses only batched wording for an earlier burst', () => {
  const result = contextualizeActivity([{ date: '2026-09-01', count: 1 }, { date: '2026-09-08', count: 30 }], [], '2026-09-01', '2026-09-15')
  expect(result[7].context).toBe('Unusual burst of 30 commits. This may reflect batched commits.')
})
