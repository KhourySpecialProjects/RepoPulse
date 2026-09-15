import { useEffect } from 'react'
import { FileText, Archive, Trash2, CheckSquare, Square, GitCommit } from 'lucide-react'
import { NoteForm, type NoteFormValues } from '@/components/NoteForm'
import { NoteComments } from '@/components/NoteComments'
import { cn } from '@/lib/utils'
import type { Note, UserDetail } from '@/types'

/**
 * The repo's notes, rendered inline as a permanent column.
 *
 * Previously a three-state drawer: an edge tab, a sliding overlay, and a
 * pinned inline mode, with the pin persisted per repo in localStorage. Reading
 * notes cost a click every visit, and the pin was a preference with no wrong
 * answer that the user still had to find. The panel is simply always here now.
 */
interface NotesDrawerProps {
  notes: Note[] | undefined
  noteCount: number
  showArchivedNotes: boolean
  onToggleArchivedNotes: () => void
  createNoteMutation: { isPending: boolean; mutate: (data: NoteFormValues) => void }
  updateNoteMutation: { mutate: (args: { id: string; data: Partial<Note> }) => void }
  deleteNoteMutation: { mutate: (id: string) => void }
  users: UserDetail[] | undefined
  currentUser: { id: string; role: string } | null | undefined
  onScrollToCommit: (hash: string) => void
  /**
   * A note arrived at from a notification. Marked and scrolled to, so it can
   * be picked out of a long list.
   */
  highlightNoteId?: string | null
}

function formatDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

function renderNoteContent(content: string) {
  const parts = content.split(/(@\w+)/g)
  return parts.map((part, i) => {
    if (part.startsWith('@') && part.length > 1) {
      const name = part.slice(1).replace(/_/g, ' ')
      return (
        <span key={i} className="inline-flex items-center bg-orchid-100 text-orchid-700 rounded px-1 py-0.5 text-xs font-medium">
          @{name}
        </span>
      )
    }
    return <span key={i}>{part}</span>
  })
}

export function NotesDrawer({
  notes,
  noteCount,
  showArchivedNotes,
  onToggleArchivedNotes,
  createNoteMutation,
  updateNoteMutation,
  deleteNoteMutation,
  users,
  currentUser,
  onScrollToCommit,
  highlightNoteId,
}: NotesDrawerProps) {
  useEffect(() => {
    if (!highlightNoteId) return
    document
      .getElementById(`note-${highlightNoteId}`)
      ?.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
  }, [highlightNoteId, notes])

  const visibleNotes = notes?.filter(n => showArchivedNotes ? true : !n.is_archived) ?? []
  const hasArchivedNotes = notes?.some(n => n.is_archived) ?? false

  const notesBody = (
    <div className="flex-1 overflow-y-auto px-4 py-3">
      {/* New note form */}
      <NoteForm
        onSubmit={createNoteMutation.mutate}
        isLoading={createNoteMutation.isPending}
        users={users ?? []}
      />

      {/* Notes list */}
      <div className="mt-4">
        {/* Archive toggle */}
        {hasArchivedNotes && (
          <button
            onClick={onToggleArchivedNotes}
            className="text-xs text-muted-foreground hover:text-foreground mb-2 flex items-center gap-1"
          >
            <Archive className="h-3 w-3" />
            {showArchivedNotes
              ? 'Hide archived'
              : `Show archived (${notes?.filter(n => n.is_archived).length ?? 0})`}
          </button>
        )}

        {!notes?.length ? (
          <p className="text-xs text-muted-foreground text-center py-4">
            No notes yet. Add the first one above.
          </p>
        ) : (
          <div>
            {visibleNotes.map((note, index) => (
              <div
                key={note.id}
                id={`note-${note.id}`}
                data-highlighted={note.id === highlightNoteId ? 'true' : undefined}
                className={cn(
                  'py-3',
                  index < visibleNotes.length - 1 && 'border-b border-border',
                  note.is_archived && 'opacity-50',
                  // Ring rather than a background tint: notes already use
                  // background to mean archived, and the two would blend.
                  note.id === highlightNoteId &&
                    '-mx-2 rounded-md px-2 ring-2 ring-brand-400'
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className={cn('text-sm flex-1 leading-relaxed', note.is_checked && 'line-through text-muted-foreground')}>
                    {renderNoteContent(note.content)}
                  </p>
                  <div className="flex items-center gap-0.5 flex-shrink-0">
                    {note.is_reminder && (
                      <span className="text-xs bg-amber-100 text-amber-700 border border-amber-200 rounded-full px-2 py-0.5 mr-1">
                        Reminder
                      </span>
                    )}
                    <button
                      onClick={() => updateNoteMutation.mutate({ id: String(note.id), data: { is_checked: !note.is_checked } })}
                      title={note.is_checked ? 'Uncheck' : 'Mark as done'}
                      className={cn('p-1 rounded transition-colors', note.is_checked ? 'text-emerald-500 hover:text-emerald-600' : 'text-muted-foreground hover:text-emerald-500')}
                    >
                      {note.is_checked ? <CheckSquare className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
                    </button>
                    <button
                      onClick={() => updateNoteMutation.mutate({ id: String(note.id), data: { is_archived: !note.is_archived } })}
                      title={note.is_archived ? 'Unarchive' : 'Archive'}
                      className="p-1 rounded text-muted-foreground hover:text-amber-500 transition-colors"
                    >
                      <Archive className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => deleteNoteMutation.mutate(String(note.id))}
                      title="Delete note"
                      className="p-1 rounded text-muted-foreground hover:text-red-500 transition-colors"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                {note.reminder_context && (
                  <p className="text-xs text-muted-foreground mt-1 italic">{note.reminder_context}</p>
                )}
                <div className="flex items-center justify-between gap-2 mt-1.5">
                  <div className="flex items-center gap-1.5">
                    <div
                      className="h-5 w-5 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-[10px] font-semibold flex-shrink-0 cursor-default"
                      title={note.author_display_name}
                    >
                      {note.author_display_name.split(' ').map((w: string) => w[0]).slice(0, 2).join('').toUpperCase()}
                    </div>
                    <p className="text-xs text-muted-foreground">{formatDateTime(note.created_at)}</p>
                  </div>
                  {note.commit_hash && (
                    <button
                      onClick={() => onScrollToCommit(note.commit_hash!)}
                      className="flex items-center gap-1 text-xs text-brand-500 hover:text-brand-700 font-mono transition-colors"
                      title="Jump to commit"
                    >
                      <GitCommit className="h-3 w-3" />
                      {note.commit_hash.slice(0, 7)}
                    </button>
                  )}
                </div>
                {currentUser && (
                  <NoteComments
                    note={note}
                    currentUserId={currentUser.id}
                    currentUserRole={currentUser.role as 'instructor' | 'ta' | 'admin'}
                    users={users ?? []}
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )

  // Sticky rather than fixed: it is a column of the page now, so it scrolls
  // with the content until it reaches the top and then holds.
  return (
    <div
      data-testid="notes-panel"
      className="w-80 flex-shrink-0 sticky top-6 self-start max-h-[calc(100vh-3rem)] flex flex-col bg-white rounded-xl border border-border overflow-hidden"
    >
      <div className="px-4 py-3 border-b border-border flex items-center gap-2 flex-shrink-0">
        <FileText className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Notes</h2>
        {noteCount > 0 && (
          <span className="text-xs bg-brand-100 text-brand-700 border border-brand-200 rounded-full px-2 py-0.5 font-medium">
            {noteCount}
          </span>
        )}
      </div>
      {notesBody}
    </div>
  )
}
