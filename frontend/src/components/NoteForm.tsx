import { useState, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { localInputToIso } from '@/lib/reminders'
import type { UserDetail } from '@/types'

export interface NoteFormValues {
  content: string
  is_reminder: boolean
  reminder_context: string
  /** ISO timestamp when the reminder should fire, or null for no due date. */
  remind_at: string | null
}

interface NoteFormProps {
  onSubmit: (values: NoteFormValues) => void | Promise<void>
  initialValues?: Partial<NoteFormValues>
  isLoading?: boolean
  submitLabel?: string
  users?: UserDetail[]
}

export function NoteForm({ onSubmit, initialValues, isLoading = false, submitLabel = 'Save Note', users = [] }: NoteFormProps) {
  const [content, setContent] = useState(initialValues?.content ?? '')
  const [isReminder, setIsReminder] = useState(initialValues?.is_reminder ?? false)
  const [reminderContext, setReminderContext] = useState(initialValues?.reminder_context ?? '')
  const [remindAtLocal, setRemindAtLocal] = useState('')
  const [mentionSearch, setMentionSearch] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const filteredUsers = mentionSearch !== null
    ? users.filter(u => u.display_name.toLowerCase().includes(mentionSearch.toLowerCase())).slice(0, 5)
    : []

  function handleContentChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value
    setContent(val)
    const cursor = e.target.selectionStart ?? val.length
    const textUpToCursor = val.slice(0, cursor)
    const lastAtIndex = textUpToCursor.lastIndexOf('@')
    if (lastAtIndex !== -1) {
      const afterAt = textUpToCursor.slice(lastAtIndex + 1)
      if (!afterAt.includes(' ') && !afterAt.includes('\n')) {
        setMentionSearch(afterAt)
        return
      }
    }
    setMentionSearch(null)
  }

  function insertMention(user: UserDetail) {
    const cursor = textareaRef.current?.selectionStart ?? content.length
    const textUpToCursor = content.slice(0, cursor)
    const lastAtIndex = textUpToCursor.lastIndexOf('@')
    const slug = user.display_name.replace(/\s+/g, '_')
    const newContent = content.slice(0, lastAtIndex) + `@${slug} ` + content.slice(cursor)
    setContent(newContent)
    setMentionSearch(null)
    setTimeout(() => textareaRef.current?.focus(), 0)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!content.trim()) return
    await onSubmit({
      content: content.trim(),
      is_reminder: isReminder,
      reminder_context: reminderContext.trim(),
      // A due date only means anything on a reminder
      remind_at: isReminder ? localInputToIso(remindAtLocal) : null,
    })
    setContent('')
    setIsReminder(false)
    setReminderContext('')
    setRemindAtLocal('')
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div className="relative">
        <Textarea
          ref={textareaRef}
          value={content}
          onChange={handleContentChange}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setMentionSearch(null)
          }}
          placeholder="Write a note... use @ to mention a user"
          className="min-h-[80px] resize-y"
          required
        />
        {mentionSearch !== null && filteredUsers.length > 0 && (
          <div className="absolute z-50 bottom-full mb-1 left-0 bg-white border border-border rounded-lg shadow-lg overflow-hidden min-w-[180px]">
            {filteredUsers.map(user => (
              <button
                key={user.id}
                type="button"
                onMouseDown={(e) => { e.preventDefault(); insertMention(user) }}
                className="w-full text-left px-3 py-1.5 text-sm hover:bg-indigo-50 hover:text-indigo-700 transition-colors"
              >
                @{user.display_name}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm cursor-pointer select-none text-muted-foreground">
          <input
            type="checkbox"
            checked={isReminder}
            onChange={(e) => setIsReminder(e.target.checked)}
            className="h-3.5 w-3.5 rounded border border-input accent-primary"
          />
          <span>Reminder</span>
        </label>

        <Button
          type="submit"
          size="sm"
          variant="outline"
          loading={isLoading} disabled={isLoading || !content.trim()}
          className={cn('text-xs h-7 px-3 bg-indigo-600 hover:bg-indigo-700 text-white border-0', isLoading && 'opacity-70 cursor-not-allowed')}
        >
          {isLoading ? 'Saving...' : submitLabel}
        </Button>
      </div>

      {isReminder && (
        <div className="flex flex-col gap-2">
          <Input
            value={reminderContext}
            onChange={(e) => setReminderContext(e.target.value)}
            placeholder="Reminder context (optional)"
            className="text-xs"
          />
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="flex-shrink-0">Remind me at</span>
            <input
              type="datetime-local"
              aria-label="Remind me at"
              value={remindAtLocal}
              onChange={(e) => setRemindAtLocal(e.target.value)}
              className="flex-1 h-7 rounded-md border border-input bg-background px-2 text-xs"
            />
          </label>
          {!remindAtLocal && (
            <p className="text-[11px] text-muted-foreground">
              Without a time this reminder is saved but never notifies you.
            </p>
          )}
        </div>
      )}
    </form>
  )
}
