import { useState, useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { FileText, Archive, Trash2, CheckSquare, Square, GitCommit, X, Pin } from 'lucide-react'
import { NoteForm } from '@/components/NoteForm'
import { NoteComments } from '@/components/NoteComments'
import { cn } from '@/lib/utils'
import type { Note, CreateNoteData, UserDetail } from '@/types'

interface NotesDrawerProps {
  repoId: string
  notes: Note[] | undefined
  noteCount: number
  showArchivedNotes: boolean
  onToggleArchivedNotes: () => void
  createNoteMutation: { isPending: boolean; mutate: (data: CreateNoteData) => void }
  updateNoteMutation: { mutate: (args: { id: string; data: Partial<Note> }) => void }
  deleteNoteMutation: { mutate: (id: string) => void }
  users: UserDetail[] | undefined
  currentUser: { id: string; role: string } | null | undefined
  onScrollToCommit: (hash: string) => void
  onPinnedChange?: (pinned: boolean) => void
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
        <span key={i} className="inline-flex items-center bg-violet-100 text-violet-700 rounded px-1 py-0.5 text-xs font-medium">
          @{name}
        </span>
      )
    }
    return <span key={i}>{part}</span>
  })
}

export function NotesDrawer({
  repoId,
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
  onPinnedChange,
}: NotesDrawerProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [isPinned, setIsPinned] = useState(() => {
    try { return localStorage.getItem(`notes-drawer-pinned-${repoId}`) === 'true' } catch { return false }
  })

  function toggleOpen() { setIsOpen(v => !v) }

  function togglePin() {
    const next = !isPinned
    setIsPinned(next)
    try { localStorage.setItem(`notes-drawer-pinned-${repoId}`, String(next)) } catch {}
    if (next) setIsOpen(true) // pinning always opens
    onPinnedChange?.(next && isOpen)
  }

  useEffect(() => {
    onPinnedChange?.(isPinned && isOpen)
  }, [isPinned, isOpen])

  useEffect(() => {
    if (!isOpen || isPinned) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setIsOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [isOpen, isPinned])

  const visibleNotes = notes?.filter(n => showArchivedNotes ? true : !n.is_archived) ?? []
  const hasArchivedNotes = notes?.some(n => n.is_archived) ?? false

  // Shared notes body content (used in both overlay and inline panel)
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
                className={cn(
                  'py-3',
                  index < visibleNotes.length - 1 && 'border-b border-border',
                  note.is_archived && 'opacity-50'
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
                      className="h-5 w-5 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-[10px] font-semibold flex-shrink-0 cursor-default"
                      title={note.author_display_name}
                    >
                      {note.author_display_name.split(' ').map((w: string) => w[0]).slice(0, 2).join('').toUpperCase()}
                    </div>
                    <p className="text-xs text-muted-foreground">{formatDateTime(note.created_at)}</p>
                  </div>
                  {note.commit_hash && (
                    <button
                      onClick={() => onScrollToCommit(note.commit_hash!)}
                      className="flex items-center gap-1 text-xs text-indigo-500 hover:text-indigo-700 font-mono transition-colors"
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
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )

  // Shared panel header content
  const panelHeader = (
    <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
      <div className="flex items-center gap-2">
        <FileText className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Notes</h2>
        {noteCount > 0 && (
          <span className="text-xs bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-full px-2 py-0.5 font-medium">
            {noteCount}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={togglePin}
          title={isPinned ? 'Unpin' : 'Pin open'}
          className={cn(
            'p-1.5 rounded transition-colors',
            isPinned
              ? 'text-indigo-600 hover:text-indigo-700'
              : 'text-gray-400 hover:text-gray-600'
          )}
        >
          <Pin className={cn('h-4 w-4', isPinned && 'fill-indigo-600')} />
        </button>
        <button
          onClick={() => setIsOpen(false)}
          title="Close"
          className="p-1.5 rounded text-gray-400 hover:text-gray-600 transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )

  // State 3: Open + pinned — render inline panel only (parent lays it out in flex row)
  if (isPinned && isOpen) {
    return (
      <div className="w-80 flex-shrink-0 sticky top-6 self-start max-h-[calc(100vh-3rem)] flex flex-col bg-white rounded-xl border border-gray-200 overflow-hidden">
        {panelHeader}
        {notesBody}
      </div>
    )
  }

  // State 1 & 2: book tab always present; overlay panel shown when open
  return (
    <>
      {/* Small book tab — hidden when panel is open in overlay mode to avoid redundancy */}
      <div
        className={cn(
          'fixed right-0 top-48 z-40 w-8 py-5 rounded-l-xl bg-white border border-r-0 border-gray-200 shadow-md hover:bg-gray-50 cursor-pointer transition-colors flex flex-col items-center gap-2',
          isOpen && 'invisible'
        )}
        onClick={toggleOpen}
        title="Open notes"
      >
        {noteCount > 0 && (
          <span className="bg-indigo-100 text-indigo-700 text-[10px] font-semibold rounded-full w-5 h-5 flex items-center justify-center leading-none flex-shrink-0">
            {noteCount}
          </span>
        )}
        <span
          className="text-xs font-medium text-gray-500 select-none"
          style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
        >
          Notes
        </span>
      </div>

      {/* Sliding overlay panel */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            className="fixed right-0 top-0 h-screen w-80 z-40 flex flex-col bg-white border-l border-gray-200 shadow-xl"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
          >
            {panelHeader}
            {notesBody}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
