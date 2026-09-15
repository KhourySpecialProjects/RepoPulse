import type { NotificationEvent } from '@/types'

export interface NotificationEventMeta {
  /** Short label for the subscription row. */
  label: string
  /** What actually triggers it, shown under the label. */
  description: string
  /** Title used for this event in the activity feed. */
  feedTitle: string
}

/**
 * The catalog of subscribable events, in the order the subscription list shows
 * them: personal mentions first, then course activity.
 *
 * Order is defined here rather than by iterating the API response, because
 * object key order is not a contract and this list is read top-to-bottom by a
 * person deciding what they want to hear about.
 */
export const NOTIFICATION_EVENTS: Array<
  { key: NotificationEvent } & NotificationEventMeta
> = [
  {
    key: 'mention',
    label: 'Mentions',
    description: 'Someone @mentions you in a note or comment',
    feedTitle: 'You were mentioned',
  },
  {
    key: 'note_comment',
    label: 'Comments on your notes',
    description: 'Someone replies to a note you wrote',
    feedTitle: 'New comment on your note',
  },
  {
    key: 'reminder',
    label: 'Reminders due',
    description: 'A reminder you own or share comes due',
    feedTitle: 'Reminder due',
  },
  {
    key: 'repo_health_declined',
    label: 'Health drops to red',
    description: "A repository's health score falls into the red band",
    feedTitle: 'Repository health declined',
  },
  {
    key: 'pr_opened',
    label: 'Pull request opened',
    description: 'A student opens a pull request',
    feedTitle: 'Pull request opened',
  },
  {
    key: 'pr_merged',
    label: 'Pull request merged',
    description: 'A pull request is merged',
    feedTitle: 'Pull request merged',
  },
  {
    key: 'repo_added',
    label: 'Repository added',
    description: 'A repository is added to a collection you can see',
    feedTitle: 'Repository added',
  },
  {
    key: 'repo_removed',
    label: 'Repository removed',
    description: 'A repository is removed from a collection you can see',
    feedTitle: 'Repository removed',
  },
]

const BY_KEY = new Map(NOTIFICATION_EVENTS.map((event) => [event.key, event]))

/** The feed title for a notification type, falling back for unknown types. */
export function feedTitleFor(type: NotificationEvent): string {
  return BY_KEY.get(type)?.feedTitle ?? 'Notification'
}
