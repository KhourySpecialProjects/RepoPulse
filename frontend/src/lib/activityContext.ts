import type { CommitActivityPoint, ContextActivityPoint } from '@/types'

const DAY = 86400000
export function contextualizeActivity(activity: CommitActivityPoint[], peers: CommitActivityPoint[][], start: string, end: string): ContextActivityPoint[] {
  const counts = new Map(activity.map(p => [p.date, p.count]))
  const points: ContextActivityPoint[] = []
  for (let ts = Date.parse(start); ts <= Date.parse(end); ts += DAY) {
    const date = new Date(ts).toISOString().slice(0, 10)
    points.push({ date, ts, count: counts.get(date) ?? 0, context: '' })
  }
  let quietStart = -1
  points.forEach((point, i) => {
    if (!point.count && quietStart < 0) quietStart = i
    if (point.count) quietStart = -1
    if (quietStart >= 0 && (i === points.length - 1 || points[i + 1].count > 0) && i - quietStart >= 2) {
      const from = points[quietStart].date
      const eligible = peers.filter(peer => peer.some(p => p.date <= from && p.count > 0))
      const active = eligible.filter(peer => peer.some(p => p.date >= from && p.date <= point.date && p.count > 0)).length
      const interval = `${i - quietStart + 1} days without commits (${from} to ${point.date}).`
      point.context = `${interval} ${!eligible.length ? 'Peer comparison unavailable for this interval.' : active ? `Potential issue: ${active} of ${eligible.length} other repositories had commits in the same interval; ${eligible.length - active} were also quiet. Check in with the student or team.` : `All ${eligible.length} other repositories were also quiet over this interval; this may reflect a shared pause.`}`
    }
    const prior = points.slice(Math.max(0, i - 7), i)
    const average = prior.reduce((sum, p) => sum + p.count, 0) / prior.length
    if (prior.length >= 7 && point.count >= 10 && point.count >= Math.max(1, average) * 3) {
      point.context = `Unusual burst: ${point.count} commits, compared with ${average.toFixed(1)} per day over the preceding week. This may reflect batched commits or a deadline; commit counts alone cannot establish the cause.`
    }
  })
  return points
}
