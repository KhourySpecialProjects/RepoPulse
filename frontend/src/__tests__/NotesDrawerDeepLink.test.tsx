/**
 * Arriving from a notification has to point at the right note.
 *
 * The panel is always on the page now, so the job is no longer opening it —
 * it is singling out one note among however many the repo has.
 * `highlightNoteId` marks that note and scrolls to it, so a reader who clicked
 * a mention is not left scanning a list for the one they were told about.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NotesDrawer } from '@/components/NotesDrawer'
import type { Note, UserDetail } from '@/types'

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
  it('singles out nothing when no note is being pointed at', () => {
    renderDrawer(null)

    // Both notes are on the page regardless — the panel is always open now.
    expect(screen.getByText('the mentioned one')).toBeInTheDocument()
    expect(document.getElementById('note-note-2')).not.toHaveAttribute(
      'data-highlighted',
      'true'
    )
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
