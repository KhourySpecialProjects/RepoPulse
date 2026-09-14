import type { Notification } from '@/types'

/**
 * Where clicking a notification should take you.
 *
 * Landing on the repo page alone leaves the reader hunting for whatever raised
 * the notification, so this resolves to the most specific thing available:
 *
 *   commit  → `/repos/:id?commit=<hash>`  the note is shown in context there
 *   note    → `/repos/:id?note=<id>`      opens the notes drawer on that note
 *   repo    → `/repos/:id`                repo-scoped events with no note
 *
 * Returns null when there is no repo at all — a standalone reminder made from
 * the notifications page — so the caller can leave the row non-interactive
 * rather than offering a click that goes nowhere. Mirrors `reminderTarget`.
 */
export function notificationTarget(notification: Notification): string | null {
  if (!notification.repo_id) return null

  const base = `/repos/${notification.repo_id}`

  if (notification.commit_hash) return `${base}?commit=${notification.commit_hash}`
  if (notification.note_id) return `${base}?note=${notification.note_id}`
  return base
}
