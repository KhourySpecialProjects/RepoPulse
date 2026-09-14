import { useState } from 'react'
import { Clock, Plus, Trash2, Users, X } from 'lucide-react'
import { useReminders } from '@/hooks/useNotifications'
import { useCreateNote, useDeleteNote } from '@/hooks/useNotes'
import { useUsers } from '@/hooks/useUsers'
import { useAuth } from '@/hooks/useAuth'
import { cn } from '@/lib/utils'
import {
  formatReminderCountdown,
  isReminderOverdue,
  localInputToIso,
} from '@/lib/reminders'

/** Shared control sizing, kept large enough to hit comfortably. */
export const ICON_BUTTON_CLASS =
  'flex-shrink-0 rounded-md p-2.5 text-muted-foreground transition-colors'

/**
 * The user's outstanding reminders, with inline create, sharing and remove.
 * Rendered full-width on the notifications page.
 */
export function ActiveRemindersPanel() {
  const { data, isLoading } = useReminders()
  const { user } = useAuth()
  const { data: allUsers } = useUsers()
  const createNote = useCreateNote()
  const deleteNote = useDeleteNote()
  const [content, setContent] = useState('')
  const [dueLocal, setDueLocal] = useState('')
  const [shareIds, setShareIds] = useState<string[]>([])
  const [adding, setAdding] = useState(false)

  const reminders = data?.items ?? []
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
      <div className="flex items-center justify-between border-b border-border/60 px-5 py-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Active reminders
          {reminders.length > 0 && (
            <span className="ml-2 font-normal normal-case">({reminders.length})</span>
          )}
        </h2>
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          aria-expanded={adding}
          className="inline-flex items-center gap-2 rounded-md border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-medium text-indigo-700 transition-colors hover:bg-indigo-100"
        >
          {adding ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {adding ? 'Cancel' : 'New reminder'}
        </button>
      </div>

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
                        ? 'border-indigo-300 bg-indigo-100 text-indigo-700'
                        : 'border-border bg-background hover:bg-muted'
                    )}
                  >
                    <input
                      type="checkbox"
                      aria-label={`Share with ${u.display_name}`}
                      checked={shareIds.includes(u.id)}
                      onChange={() => toggleShare(u.id)}
                      className="h-4 w-4 accent-indigo-600"
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
            className="h-10 self-start rounded-md bg-indigo-600 px-4 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
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
            return (
              <li
                key={reminder.id}
                data-testid="reminder-row"
                className="flex items-start gap-3 border-b border-border/40 px-5 py-4 transition-colors last:border-0 hover:bg-muted/40"
              >
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
                </div>
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
