/**
 * Human-readable countdown to a reminder's due time.
 *
 * Reminders fire server-side once `remind_at` passes, so the label has to cover
 * both directions: still pending ("in 2h") and already fired ("30m overdue").
 */
export function formatReminderCountdown(
  remindAt: string | null,
  now: Date = new Date()
): string {
  if (!remindAt) return 'No due date'

  const deltaMs = new Date(remindAt).getTime() - now.getTime()
  const minutes = Math.round(Math.abs(deltaMs) / 60_000)

  if (minutes === 0) return 'due now'

  const amount =
    minutes < 60
      ? `${minutes}m`
      : minutes < 60 * 24
        ? `${Math.floor(minutes / 60)}h`
        : `${Math.floor(minutes / (60 * 24))}d`

  return deltaMs > 0 ? `in ${amount}` : `${amount} overdue`
}

/** True when a reminder's due time has passed. */
export function isReminderOverdue(
  remindAt: string | null,
  now: Date = new Date()
): boolean {
  if (!remindAt) return false
  return new Date(remindAt).getTime() <= now.getTime()
}

/**
 * Convert a `datetime-local` input value into an ISO string for the API.
 * Returns null for an empty input, meaning "reminder with no due date".
 */
export function localInputToIso(value: string): string | null {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}
