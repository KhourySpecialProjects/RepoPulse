import { useNotes, useCreateNote } from '@/hooks/useNotes'
import { useUsers } from '@/hooks/useUsers'
import { useAuth } from '@/hooks/useAuth'
import { NoteForm } from '@/components/NoteForm'
import { NoteComments } from '@/components/NoteComments'
import type { CreateNoteData } from '@/types'

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

interface CommitNotesPanelProps {
  repoId: string
  commitHash: string
  collectionId?: string
}

export function CommitNotesPanel({ repoId, commitHash, collectionId }: CommitNotesPanelProps) {
  const { data: notes } = useNotes({ repo_id: repoId, commit_hash: commitHash })
  const createNoteMutation = useCreateNote()
  const { data: users } = useUsers(collectionId ? { collection_id: collectionId } : undefined)
  const { user: currentUser } = useAuth()

  async function handleSubmit(values: { content: string; is_reminder: boolean; reminder_context: string; remind_at: string | null }) {
    const noteData: CreateNoteData = {
      content: values.content,
      is_reminder: values.is_reminder,
      reminder_context: values.reminder_context || null,
      remind_at: values.remind_at,
      repo_id: repoId,
      commit_hash: commitHash,
    }
    await createNoteMutation.mutateAsync(noteData)
  }

  return (
    <div className="bg-gray-50 rounded-lg border border-border p-3 mx-2">
      <NoteForm onSubmit={handleSubmit} isLoading={createNoteMutation.isPending} submitLabel="Add Note" users={users ?? []} />
      {notes && notes.length > 0 && (
        <div className="mt-3 flex flex-col gap-2">
          {notes.filter(n => !n.is_archived).map((note) => (
            <div key={note.id} className={`text-sm border-t pt-2 ${note.is_checked ? 'line-through text-muted-foreground' : ''}`}>
              <p className="whitespace-pre-wrap">{renderNoteContent(note.content)}</p>
              <p className="text-xs text-muted-foreground mt-1">
                {new Date(note.created_at).toLocaleString('en-US', {
                  month: 'short', day: 'numeric', year: 'numeric',
                  hour: 'numeric', minute: '2-digit',
                })}
              </p>
              {currentUser && (
                <NoteComments
                  note={note}
                  currentUserId={currentUser.id}
                  currentUserRole={currentUser.role}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
