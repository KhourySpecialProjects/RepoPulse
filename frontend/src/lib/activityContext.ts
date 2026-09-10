import type { CommitActivityPoint, ContextActivityPoint } from '@/types'

const DAY = 86400000
export function contextualizeActivity(activity: CommitActivityPoint[], peers: CommitActivityPoint[][], start: string, end: string): ContextActivityPoint[] {
  const counts = new Map(activity.map(p => [p.date, p.count]))
  const points: ContextActivityPoint[] = []
  for (let ts = Date.parse(start); ts <= Date.parse(end); ts += DAY) {
    const date = new Date(ts).toISOString().slice(0, 10)
    points.push({ date, ts, count: counts.get(date) ?? 0, context: '' })
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
    }
    const prior = points.slice(Math.max(0, i - 7), i)
    const average = prior.reduce((sum, p) => sum + p.count, 0) / prior.length
    if (prior.length >= 7 && point.count >= 10 && point.count >= Math.max(1, average) * 3) {
      const finalPush = i >= points.length - 2 && point.count >= total * 0.8
      point.context = `Unusual burst of ${point.count} commits. This may reflect ${finalPush ? 'a deadline push' : 'batched commits'}.`
    }
  })
  return points
}
