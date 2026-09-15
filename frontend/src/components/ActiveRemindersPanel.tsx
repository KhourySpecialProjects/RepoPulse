import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  BellRing,
  ChevronDown,
  Clock,
  GitCommit,
  Plus,
  Trash2,
  Users,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  useNotificationPreferences,
  useReminders,
  useUpdateNotificationPreferences,
} from '@/hooks/useNotifications'
import { useCreateNote, useDeleteNote } from '@/hooks/useNotes'
import { usePrefetchRepo } from '@/hooks/useRepos'
import { useUsers } from '@/hooks/useUsers'
import { useAuth } from '@/hooks/useAuth'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'
import { NOTIFICATION_EVENTS } from '@/lib/notificationEvents'
import {
  formatReminderCountdown,
  isReminderOverdue,
  localInputToIso,
  reminderTarget,
} from '@/lib/reminders'
import type { NotificationEvent } from '@/types'

/** Shared control sizing, kept large enough to hit comfortably. */
export const ICON_BUTTON_CLASS =
  'flex-shrink-0 rounded-md p-2.5 text-muted-foreground transition-colors'

/**
 * Per-account choice of which events raise a notification at all.
 *
 * Subscriptions belong to the signed-in user, so a TA muting pull requests
 * changes nothing for the professor on the same collection. Unchecking stops
 * the notification being created rather than hiding it, which is why the copy
 * says the event will not be recorded: re-checking affects future activity
 * only, it does not bring back a backlog.
 *
 * Saves on change rather than behind a Save button — each checkbox is a single
 * complete decision, and a Save button for one checkbox is friction.
 */
function NotificationPreferencesList() {
  const { data, isLoading } = useNotificationPreferences()
  const update = useUpdateNotificationPreferences()

  async function toggle(key: NotificationEvent, subscribed: boolean) {
    try {
      await update.mutateAsync({ subscribed_events: { [key]: subscribed } })
    } catch {
      toast.error('Could not change that notification')
    }
  }

  if (isLoading || !data) {
    return (
      <p className="px-5 py-6 text-center text-sm text-muted-foreground">
        Loading notification choices...
      </p>
    )
  }

  return (
    <div
      data-testid="notification-preferences"
      className="border-b border-border/60 px-5 py-4"
    >
      <p className="mb-3 text-xs text-muted-foreground">
        Unchecked events are not recorded at all — you will not see them here or
        in the activity feed. This applies to your account only.
      </p>
      <ul className="flex flex-col">
        {NOTIFICATION_EVENTS.map((event) => {
          const subscribed = data.subscribed_events[event.key] ?? true
          return (
            <li key={event.key}>
              <label className="flex cursor-pointer items-start gap-3 rounded-md px-2 py-2 transition-colors hover:bg-muted/50">
                <span className="mt-0.5">
                  <Checkbox
                    checked={subscribed}
                    onCheckedChange={(next) => toggle(event.key, next)}
                    disabled={update.isPending}
                    aria-label={event.label}
                  />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-foreground">
                    {event.label}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {event.description}
                  </span>
                </span>
              </label>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/**
 * The user's outstanding reminders, with inline create, sharing and remove.
 * Rendered full-width on the notifications page.
 */
export function ActiveRemindersPanel() {
  const { data, isLoading } = useReminders()
  const navigate = useNavigate()
  const prefetchRepo = usePrefetchRepo()
  const { user } = useAuth()
  const { data: allUsers } = useUsers()
  const createNote = useCreateNote()
  const deleteNote = useDeleteNote()
  const [content, setContent] = useState('')
  const [dueLocal, setDueLocal] = useState('')
  const [shareIds, setShareIds] = useState<string[]>([])
  const [adding, setAdding] = useState(false)
  // Collapsed by default: the reminders themselves are what this panel is for,
  // and subscriptions are set once and rarely revisited.
  const [choosing, setChoosing] = useState(false)
  const { data: preferences } = useNotificationPreferences()

  const reminders = data?.items ?? []
  const mutedCount = Object.values(preferences?.subscribed_events ?? {}).filter(
    (subscribed) => !subscribed
  ).length
  // You always get your own reminder, so sharing with yourself is meaningless.
  const shareableUsers = (allUsers ?? []).filter((u) => u.id !== user?.id)

  function toggleShare(id: string) {
    setShareIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    )
  }

  async function handleAdd() {
    if (!content.trim()) return
    await createNote.mutateAsync({
      content: content.trim(),
      is_reminder: true,
      // A due date is optional: an undated reminder is a to-do that never alerts.
      remind_at: localInputToIso(dueLocal),
      shared_with: shareableUsers.filter((u) => shareIds.includes(u.id)).map((u) => u.id),
    })
    setContent('')
    setDueLocal('')
    setShareIds([])
    setAdding(false)
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-5 py-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Active reminders
          {reminders.length > 0 && (
            <span className="ml-2 font-normal normal-case">({reminders.length})</span>
          )}
        </h2>
        <div className="flex flex-shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setChoosing((v) => !v)}
            aria-expanded={choosing}
            className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted"
          >
            <BellRing className="h-4 w-4" />
            Notify me about
            {/* Surfaced while collapsed, so a muted event is never a silent
                mystery when something expected fails to arrive. */}
            {mutedCount > 0 && (
              <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700">
                {mutedCount} muted
              </span>
            )}
            <ChevronDown
              aria-hidden="true"
              className={cn(
                'h-4 w-4 transition-transform',
                choosing && 'rotate-180'
              )}
            />
          </button>
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            aria-expanded={adding}
            className="inline-flex items-center gap-2 rounded-md border border-brand-200 bg-brand-50 px-3 py-2 text-sm font-medium text-brand-700 transition-colors hover:bg-brand-100"
          >
            {adding ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            {adding ? 'Cancel' : 'New reminder'}
          </button>
        </div>
      </div>

      {choosing && <NotificationPreferencesList />}

      {adding && (
        <div className="flex flex-col gap-3 border-b border-border/60 px-5 py-4">
          <input
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Remind me to..."
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          />

          <label className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span className="flex-shrink-0">Due</span>
            <input
              type="datetime-local"
              aria-label="Due"
              value={dueLocal}
              onChange={(e) => setDueLocal(e.target.value)}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            />
            <span className="text-xs">(optional — leave empty for a reminder with no alert)</span>
          </label>

          {shareableUsers.length > 0 && (
            <div>
              <p className="mb-2 flex items-center gap-1.5 text-sm text-muted-foreground">
                <Users className="h-4 w-4" />
                Share with
              </p>
              <div className="flex flex-wrap gap-2">
                {shareableUsers.map((u) => (
                  <label
                    key={u.id}
                    className={cn(
                      'inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors',
                      shareIds.includes(u.id)
                        ? 'border-brand-300 bg-brand-100 text-brand-700'
                        : 'border-border bg-background hover:bg-muted'
                    )}
                  >
                    <input
                      type="checkbox"
                      aria-label={`Share with ${u.display_name}`}
                      checked={shareIds.includes(u.id)}
                      onChange={() => toggleShare(u.id)}
                      className="h-4 w-4 accent-brand-600"
                    />
                    {u.display_name}
                  </label>
                ))}
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={handleAdd}
            disabled={!content.trim() || createNote.isPending}
            className="h-10 self-start rounded-md bg-brand-600 px-4 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Add reminder
          </button>
        </div>
      )}

      {isLoading ? (
        <p className="px-5 py-10 text-center text-sm text-muted-foreground">
          Loading reminders...
        </p>
      ) : reminders.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-muted-foreground">
          No active reminders
        </p>
      ) : (
        <ul data-testid="reminders-list">
          {reminders.map((reminder) => {
            const overdue = isReminderOverdue(reminder.remind_at)
            const target = reminderTarget(reminder)

            const details = (
              <>
                <Clock
                  className={cn(
                    'mt-0.5 h-5 w-5 flex-shrink-0',
                    overdue ? 'text-red-500' : 'text-amber-500'
                  )}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">
                    {reminder.content}
                  </p>
                  <p
                    className={cn(
                      'mt-1 text-xs',
                      overdue ? 'font-medium text-red-600' : 'text-muted-foreground'
                    )}
                  >
                    {formatReminderCountdown(reminder.remind_at)}
                  </p>
                  {!reminder.is_owner && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Shared by {reminder.owner_display_name}
                    </p>
                  )}
                  {reminder.is_owner && reminder.shared_with.length > 0 && (
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Users className="h-3.5 w-3.5" />
                      Shared with {reminder.shared_with.join(', ')}
                    </p>
                  )}
                  {reminder.commit_hash && (
                    <p className="mt-1 flex items-center gap-1.5 font-mono text-xs text-brand-600">
                      <GitCommit className="h-3.5 w-3.5 flex-shrink-0" />
                      {reminder.commit_hash.slice(0, 7)}
                    </p>
                  )}
                </div>
              </>
            )

            return (
              <li
                key={reminder.id}
                data-testid="reminder-row"
                className="flex items-start gap-3 border-b border-border/40 px-5 py-4 transition-colors last:border-0 hover:bg-muted/40"
              >
                {target ? (
                  <button
                    type="button"
                    onClick={() => navigate(target)}
                    // Warm the repo's queries before the click lands, so the
                    // page can jump to the commit without a cold fetch first.
                    onMouseEnter={() => prefetchRepo(reminder.repo_id!)}
                    onFocus={() => prefetchRepo(reminder.repo_id!)}
                    title={
                      reminder.commit_hash
                        ? 'Go to the commit this reminder is on'
                        : 'Go to the repository this reminder is on'
                    }
                    className="flex min-w-0 flex-1 items-start gap-3 text-left"
                  >
                    {details}
                  </button>
                ) : (
                  // Nothing to navigate to, so this stays plain text.
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    {details}
                  </div>
                )}

                {reminder.is_owner && (
                  <button
                    type="button"
                    onClick={() => deleteNote.mutate(reminder.id)}
                    title="Remove reminder"
                    className={cn(ICON_BUTTON_CLASS, 'hover:bg-red-50 hover:text-red-500')}
                  >
                    <Trash2 className="h-5 w-5" />
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
