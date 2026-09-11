import { useState } from 'react'
import { Clock, Plus, Trash2, X } from 'lucide-react'
import { useReminders } from '@/hooks/useNotifications'
import { useCreateNote, useDeleteNote } from '@/hooks/useNotes'
import { cn } from '@/lib/utils'
import {
  formatReminderCountdown,
  isReminderOverdue,
  localInputToIso,
} from '@/lib/reminders'

/**
 * The user's outstanding reminders, with inline create and remove.
 * Rendered full-width on the notifications page, so it is sized for a page
 * rather than the popover this started life in.
 */
export function ActiveRemindersPanel() {
  const { data, isLoading } = useReminders()
  const createNote = useCreateNote()
  const deleteNote = useDeleteNote()
  const [content, setContent] = useState('')
  const [dueLocal, setDueLocal] = useState('')
  const [adding, setAdding] = useState(false)

  const reminders = data?.items ?? []

  async function handleAdd() {
    if (!content.trim()) return
    await createNote.mutateAsync({
      content: content.trim(),
      is_reminder: true,
      remind_at: localInputToIso(dueLocal),
    })
    setContent('')
    setDueLocal('')
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
          title={adding ? 'Cancel' : 'New reminder'}
          aria-expanded={adding}
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-indigo-100 hover:text-indigo-600"
        >
          {adding ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
        </button>
      </div>

      {adding && (
        <div className="flex flex-col gap-3 border-b border-border/60 px-5 py-4 sm:flex-row sm:items-center">
          <input
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Remind me to..."
            className="h-10 flex-1 rounded-md border border-input bg-background px-3 text-sm"
          />
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="flex-shrink-0">Due</span>
            <input
              type="datetime-local"
              aria-label="Due"
              value={dueLocal}
              onChange={(e) => setDueLocal(e.target.value)}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            />
          </label>
          <button
            type="button"
            onClick={handleAdd}
            disabled={!content.trim() || createNote.isPending}
            className="h-10 flex-shrink-0 rounded-md bg-indigo-600 px-4 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
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
                </div>
                <button
                  type="button"
                  onClick={() => deleteNote.mutate(reminder.id)}
                  title="Remove reminder"
                  className="flex-shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-red-50 hover:text-red-500"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
