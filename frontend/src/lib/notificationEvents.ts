import type { NotificationEvent } from '@/types'

/**
 * Feed title per notification type.
 *
 * Only the note-scoped types actually read from this — repo-scoped events carry
 * their own `subject` from the backend. They are all listed anyway so a type
 * that later stops sending a subject degrades to a title rather than to
 * "Notification".
 */
const FEED_TITLES: Record<NotificationEvent, string> = {
  mention: 'You were mentioned',
  note_comment: 'New comment on your note',
  reminder: 'Reminder due',
  repo_health_declined: 'Repository health declined',
  pr_opened: 'Pull request opened',
  pr_merged: 'Pull request merged',
  repo_added: 'Repository added',
  repo_removed: 'Repository removed',
}

/** The feed title for a notification type, falling back for unknown types. */
export function feedTitleFor(type: NotificationEvent): string {
  return FEED_TITLES[type] ?? 'Notification'
}
