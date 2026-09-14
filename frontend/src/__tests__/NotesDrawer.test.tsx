/**
 * Notes are part of the page, not a drawer you have to summon.
 *
 * This panel used to have three states — a vertical tab on the right edge, a
 * sliding overlay, and a pinned inline column — plus a pin toggle persisted to
 * localStorage. Reading a repo's notes meant a click every time, and the pin
 * was a preference with no wrong answer that still had to be discovered.
 *
 * It now renders inline, always, with no open/close and no pin.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { NotesDrawer } from '@/components/NotesDrawer'
import type { Note, UserDetail } from '@/types'

vi.mock('@/components/NoteForm', () => ({
  NoteForm: ({ onSubmit }: { onSubmit: () => void }) => (
    <form data-testid="note-form" onSubmit={onSubmit}>
      <button type="submit">Save Note</button>
    </form>
  ),
}))

vi.mock('@/components/NoteComments', () => ({
  NoteComments: ({ note }: { note: Note }) => (
    <div data-testid={`note-comments-${note.id}`} />
  ),
}))

const mockNote: Note = {
  id: 'note-1',
  author_id: 'user-1',
  author_display_name: 'Alice Smith',
  repo_id: 'repo-abc',
  contributor_id: null,
  commit_hash: null,
  content: 'This is a test note',
  is_reminder: false,
  reminder_context: null,
  remind_at: null,
  is_checked: false,
  is_archived: false,
  created_at: '2026-01-15T10:00:00Z',
  updated_at: '2026-01-15T10:00:00Z',
  comments: [],
}

const mockUsers: UserDetail[] = [
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

const defaultProps = {
  notes: [mockNote],
  noteCount: 1,
  showArchivedNotes: false,
  onToggleArchivedNotes: vi.fn(),
  createNoteMutation: { isPending: false, mutate: vi.fn() },
  updateNoteMutation: { mutate: vi.fn() },
  deleteNoteMutation: { mutate: vi.fn() },
  users: mockUsers,
  currentUser: { id: 'user-1', role: 'instructor' },
  onScrollToCommit: vi.fn(),
}

describe('NotesDrawer', () => {
  it('shows its notes straight away, with nothing to click first', () => {
    render(<NotesDrawer {...defaultProps} />)

    expect(screen.getByText('This is a test note')).toBeInTheDocument()
    expect(screen.getByTestId('note-form')).toBeInTheDocument()
  })

  it('has no tab, close, or pin control', () => {
    render(<NotesDrawer {...defaultProps} />)

    expect(screen.queryByTitle('Open notes')).not.toBeInTheDocument()
    expect(screen.queryByTitle('Close')).not.toBeInTheDocument()
    expect(screen.queryByTitle('Pin open')).not.toBeInTheDocument()
    expect(screen.queryByTitle('Unpin')).not.toBeInTheDocument()
  })

  it('keeps its heading and note count', () => {
    render(<NotesDrawer {...defaultProps} noteCount={3} />)

    expect(screen.getByText('Notes')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('shows no count badge when there are no notes', () => {
    render(<NotesDrawer {...defaultProps} noteCount={0} notes={[]} />)

    expect(screen.getByText('Notes')).toBeInTheDocument()
    expect(screen.queryByText('0')).not.toBeInTheDocument()
  })

  it('renders comments for each note', () => {
    render(<NotesDrawer {...defaultProps} />)
    expect(screen.getByTestId('note-comments-note-1')).toBeInTheDocument()
  })

  it('offers the archive toggle when something is archived', () => {
    const archivedNote: Note = { ...mockNote, id: 'note-2', is_archived: true }
    render(<NotesDrawer {...defaultProps} notes={[mockNote, archivedNote]} />)

    expect(screen.getByText(/Show archived/)).toBeInTheDocument()
  })

  it('calls onToggleArchivedNotes when that toggle is clicked', () => {
    const onToggle = vi.fn()
    const archivedNote: Note = { ...mockNote, id: 'note-2', is_archived: true }
    render(
      <NotesDrawer
        {...defaultProps}
        notes={[mockNote, archivedNote]}
        onToggleArchivedNotes={onToggle}
      />
    )

    fireEvent.click(screen.getByText(/Show archived/))
    expect(onToggle).toHaveBeenCalled()
  })

  it('does not persist any drawer preference', () => {
    // The pin used to write `notes-drawer-pinned-<repoId>`. Nothing should be
    // storing layout state per repo now.
    render(<NotesDrawer {...defaultProps} />)
    expect(localStorage.getItem('notes-drawer-pinned-repo-abc')).toBeNull()
  })
})
