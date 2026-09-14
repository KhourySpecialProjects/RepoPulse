import { useState, useRef } from 'react'
import { useMentions } from '@/hooks/useMentions'
import { MentionSuggestions } from '@/components/MentionSuggestions'
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
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const mentions = useMentions(users, textareaRef)

  function handleContentChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value
    setContent(val)
    mentions.handleChange(val, e.target.selectionStart ?? val.length)
  }

  function insertMention(user: UserDetail) {
    const cursor = textareaRef.current?.selectionStart ?? content.length
    setContent(mentions.insert(user, content, cursor))
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
            if (e.key === 'Escape') mentions.cancel()
          }}
          placeholder="Write a note... use @ to mention a user"
          className="min-h-[80px] resize-y"
          required
        />
        {mentions.search !== null && (
          <MentionSuggestions users={mentions.matches} onSelect={insertMention} />
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
