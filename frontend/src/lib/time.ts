/**
 * Coarse "how long ago" label for activity feeds.
 *
 * Deliberately imprecise — a feed reader wants "2h ago", not a timestamp — and
 * shared so the notifications page and the dashboard panel never drift apart.
 */
export function formatTimeAgo(isoStr: string): string {
  const ms = Date.now() - new Date(isoStr).getTime()
  const minutes = Math.floor(ms / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}
