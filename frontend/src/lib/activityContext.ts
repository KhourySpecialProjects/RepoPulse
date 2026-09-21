import type { ActivityContextKind, CommitActivityPoint, ContextActivityPoint } from '@/types'

/**
 * The graph's marker legend, in the order it renders.
 *
 * All four always render, so the list doubles as a key explaining the marker
 * colours whether or not a given kind is on screen today.
 *
 * A red→orange→yellow→green severity ramp, ordered loudest to quietest. The
 * steps are the best-separating ones available for that ramp: adjacent pairs
 * clear the dataviz validator at ΔE 14.6 (deuteranopia) and 20.4 (normal
 * vision), worst being yellow↔orange.
 *
 * Two known limits, both inherent to a traffic-light ramp rather than to these
 * particular steps:
 *
 *  - Non-adjacent pairs do not all separate. Orange↔green is ΔE 3.3 under
 *    protanopia — red, orange and yellow collapse onto one axis for red-weak
 *    readers, and no choice of steps fixes that. A reader who cannot separate
 *    two markers by colour has the tooltip, which names the kind in words.
 *  - The yellow is 1.87:1 against the card, well under 3:1, so a light dot on a
 *    white surface would otherwise vanish. Markers therefore carry a dark ring
 *    instead of the usual surface-coloured one, which is what makes every step
 *    visible regardless of its own contrast.
 *
 * The visible text labels beside each swatch are the required relief for both,
 * which is why this legend is not optional.
 */
export const ACTIVITY_LEGEND: {
  key: ActivityContextKind | 'good'
  label: string
  color: string
}[] = [
  { key: 'burst-deadline', label: 'Deadline Burst', color: '#991b1b' },
  { key: 'burst-unusual', label: 'Unusual Burst', color: '#ea580c' },
  { key: 'quiet', label: 'Quiet Period', color: '#eab308' },
  { key: 'good', label: 'Good Commit History', color: '#15803d' },
]

/** Markers wear this instead of a surface-coloured ring — see the note above on
 *  the yellow's contrast. Also keeps every marker legible over the area fill. */
export const MARKER_RING = '#334155'

/** The ✓ shown when no day earned a marker. */
export const GOOD_HISTORY_COLOR =
  ACTIVITY_LEGEND.find(e => e.key === 'good')!.color

const KIND_COLOR = new Map(ACTIVITY_LEGEND.map(e => [e.key, e.color]))

export function activityContextColor(kind: ActivityContextKind): string {
  return KIND_COLOR.get(kind) ?? GOOD_HISTORY_COLOR
}

const DAY = 86400000
export function contextualizeActivity(activity: CommitActivityPoint[], peers: CommitActivityPoint[][], start: string, end: string): ContextActivityPoint[] {
  const counts = new Map(activity.map(p => [p.date, p.count]))
  const points: ContextActivityPoint[] = []
  for (let ts = Date.parse(start); ts <= Date.parse(end); ts += DAY) {
    const date = new Date(ts).toISOString().slice(0, 10)
    points.push({ date, ts, count: counts.get(date) ?? 0, context: '', kind: null })
  }
  const total = points.reduce((sum, point) => sum + point.count, 0)
  let quietStart = -1
  points.forEach((point, i) => {
    if (!point.count && quietStart < 0) quietStart = i
    if (point.count) quietStart = -1
    if (quietStart >= 0 && (i === points.length - 1 || points[i + 1].count > 0) && i - quietStart >= 2) {
      const from = points[quietStart].date
      const eligible = peers.filter(peer => peer.some(p => p.date <= from && p.count > 0))
      const active = eligible.filter(peer => peer.some(p => p.date >= from && p.date <= point.date && p.count > 0)).length
      const interval = `${i - quietStart + 1} days without commits.`
      point.context = `${interval} ${!eligible.length ? 'Peer comparison unavailable.' : active ? `Potential issue: ${active} of ${eligible.length} peer repos were active. Consider a check-in.` : `All ${eligible.length} peer repos were also quiet. Likely a shared pause.`}`
      // One kind for every quiet stretch. Whether peers kept working is what
      // separates "check in" from "shared pause", and that distinction lives in
      // the context text above rather than in a second marker colour.
      point.kind = 'quiet'
    }
    const prior = points.slice(Math.max(0, i - 7), i)
    const average = prior.reduce((sum, p) => sum + p.count, 0) / prior.length
    if (prior.length >= 7 && point.count >= 10 && point.count >= Math.max(1, average) * 3) {
      const finalPush = i >= points.length - 2 && point.count >= total * 0.8
      point.context = `Unusual burst of ${point.count} commits. This may reflect ${finalPush ? 'a deadline push' : 'batched commits'}.`
      // A late spike carrying most of the project's commits is the loudest
      // signal here — worth its own marker rather than sharing one with the
      // routine case of someone pushing a day's work in one go.
      point.kind = finalPush ? 'burst-deadline' : 'burst-unusual'
    }
  })
  return points
}
