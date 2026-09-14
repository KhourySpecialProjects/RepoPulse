/**
 * Arriving from a notification has to open the drawer on the right note.
 *
 * The notes drawer starts closed, so a deep link that only navigated to the
 * repo left the note it was about behind a shut panel. `highlightNoteId` is
 * the one signal that opens it and marks the note, so the reader sees what
 * they were notified about instead of a closed drawer.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NotesDrawer } from '@/components/NotesDrawer'
import type { Note, UserDetail } from '@/types'

vi.mock('framer-motion', () => ({
  motion: {
    div: ({
      children,
      ...props
    }: React.HTMLAttributes<HTMLDivElement> & { children?: React.ReactNode }) => (
      <div {...props}>{children}</div>
    ),
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('@/components/NoteForm', () => ({
  NoteForm: () => <form data-testid="note-form" />,
}))

vi.mock('@/components/NoteComments', () => ({
  NoteComments: ({ note }: { note: Note }) => (
    <div data-testid={`note-comments-${note.id}`} />
  ),
}))

function makeNote(id: string, content: string): Note {
  return {
    id,
    author_id: 'user-1',
    author_display_name: 'Alice Smith',
    repo_id: 'repo-abc',
    contributor_id: null,
    commit_hash: null,
    content,
    is_reminder: false,
    reminder_context: null,
    remind_at: null,
    is_checked: false,
    is_archived: false,
    created_at: '2026-01-15T10:00:00Z',
    updated_at: '2026-01-15T10:00:00Z',
    comments: [],
  }
}

const notes = [makeNote('note-1', 'first note'), makeNote('note-2', 'the mentioned one')]

const users: UserDetail[] = [
  {
    id: 'user-1',
    display_name: 'Alice Smith',
    email: 'alice@example.com',
    role: 'instructor',
    github_token_configured: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
]

function renderDrawer(highlightNoteId: string | null) {
  return render(
    <NotesDrawer
      repoId="repo-abc"
      notes={notes}
      noteCount={notes.length}
      showArchivedNotes={false}
      onToggleArchivedNotes={vi.fn()}
      createNoteMutation={{ isPending: false, mutate: vi.fn() }}
      updateNoteMutation={{ mutate: vi.fn() }}
      deleteNoteMutation={{ mutate: vi.fn() }}
      users={users}
      currentUser={{ id: 'user-1', role: 'instructor' }}
      onScrollToCommit={vi.fn()}
      highlightNoteId={highlightNoteId}
    />
  )
}

describe('NotesDrawer deep link', () => {
  it('stays shut when nothing is being pointed at', () => {
    renderDrawer(null)
    expect(screen.queryByText('the mentioned one')).not.toBeInTheDocument()
  })

  it('opens itself when a note is deep-linked', () => {
    renderDrawer('note-2')
    expect(screen.getByText('the mentioned one')).toBeInTheDocument()
  })

  it('marks the linked note so it is findable among the others', () => {
    renderDrawer('note-2')

    const target = document.getElementById('note-note-2')
    expect(target).not.toBeNull()
    expect(target).toHaveAttribute('data-highlighted', 'true')

    // The other note is present but not singled out.
    expect(document.getElementById('note-note-1')).not.toHaveAttribute(
      'data-highlighted',
      'true'
    )
  })
})
