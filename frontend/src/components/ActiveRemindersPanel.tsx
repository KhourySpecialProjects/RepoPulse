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
 * Rendered on the notifications page.
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
    <div className="border-b border-border bg-muted/30">
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Active reminders
          {reminders.length > 0 && (
            <span className="ml-1.5 font-normal normal-case">({reminders.length})</span>
          )}
        </span>
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          title={adding ? 'Cancel' : 'New reminder'}
          className="text-muted-foreground hover:text-indigo-600 transition-colors p-0.5"
        >
          {adding ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
        </button>
      </div>

      {adding && (
        <div className="flex flex-col gap-1.5 px-3 pb-2">
          <input
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Remind me to..."
            className="h-7 rounded-md border border-input bg-background px-2 text-xs"
          />
          <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="flex-shrink-0">Due</span>
            <input
              type="datetime-local"
              aria-label="Due"
              value={dueLocal}
              onChange={(e) => setDueLocal(e.target.value)}
              className="flex-1 h-7 rounded-md border border-input bg-background px-2 text-[11px]"
            />
          </label>
          <button
            type="button"
            onClick={handleAdd}
            disabled={!content.trim() || createNote.isPending}
            className="h-7 rounded-md bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Add reminder
          </button>
        </div>
      )}

      {isLoading ? (
        <p className="px-3 pb-2 text-xs text-muted-foreground">Loading reminders...</p>
      ) : reminders.length === 0 ? (
        <p className="px-3 pb-2 text-xs text-muted-foreground">No active reminders</p>
      ) : (
        <ul className="max-h-40 overflow-y-auto">
          {reminders.map((reminder) => {
            const overdue = isReminderOverdue(reminder.remind_at)
            return (
              <li
                key={reminder.id}
                className="flex items-start gap-2 px-3 py-1.5 border-t border-border/50"
              >
                <Clock
                  className={cn(
                    'h-3.5 w-3.5 flex-shrink-0 mt-0.5',
                    overdue ? 'text-red-500' : 'text-amber-500'
                  )}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-foreground truncate">{reminder.content}</p>
                  <p
                    className={cn(
                      'text-[10px]',
                      overdue ? 'text-red-600 font-medium' : 'text-muted-foreground'
                    )}
                  >
                    {formatReminderCountdown(reminder.remind_at)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => deleteNote.mutate(reminder.id)}
                  title="Remove reminder"
                  className="flex-shrink-0 text-muted-foreground hover:text-red-500 transition-colors p-0.5"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
