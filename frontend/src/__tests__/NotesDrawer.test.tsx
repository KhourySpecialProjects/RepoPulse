import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { NotesDrawer } from '@/components/NotesDrawer'
import type { Note, UserDetail } from '@/types'

// Mock framer-motion so tests don't need animation support
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement> & { children?: React.ReactNode }) => <div {...props}>{children}</div>,
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

// Mock NoteForm and NoteComments
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
  created_at: '2025-01-15T10:00:00Z',
  updated_at: '2025-01-15T10:00:00Z',
  comments: [],
}

const mockUsers: UserDetail[] = [
  {
    id: 'user-1',
    display_name: 'Alice Smith',
    email: 'alice@example.com',
    role: 'instructor',
    github_token_configured: false,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
  },
]

const defaultProps = {
  repoId: 'repo-abc',
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
  beforeEach(() => {
    localStorage.clear()
  })

  it('renders the trigger strip with Notes label', () => {
    render(<NotesDrawer {...defaultProps} />)
    expect(screen.getByText('Notes')).toBeInTheDocument()
  })

  it('shows a badge with note count on the trigger strip when notes exist', () => {
    render(<NotesDrawer {...defaultProps} noteCount={3} />)
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('does not show a badge when noteCount is 0', () => {
    render(<NotesDrawer {...defaultProps} noteCount={0} notes={[]} />)
    // Only the "Notes" label should be present, no count badge
    expect(screen.getByText('Notes')).toBeInTheDocument()
    expect(screen.queryByText('0')).not.toBeInTheDocument()
  })

  it('drawer is closed by default', () => {
    render(<NotesDrawer {...defaultProps} />)
    // The NoteForm is inside the drawer body, which should not be visible when closed
    expect(screen.queryByTestId('note-form')).not.toBeInTheDocument()
  })

  it('opens the drawer when trigger strip is clicked', () => {
    render(<NotesDrawer {...defaultProps} />)
    const strip = screen.getByTitle('Open notes')
    fireEvent.click(strip)
    expect(screen.getByTestId('note-form')).toBeInTheDocument()
  })

  it('closes the drawer when close button is clicked', () => {
    render(<NotesDrawer {...defaultProps} />)
    // Open first
    fireEvent.click(screen.getByTitle('Open notes'))
    expect(screen.getByTestId('note-form')).toBeInTheDocument()
    // Close
    fireEvent.click(screen.getByTitle('Close'))
    expect(screen.queryByTestId('note-form')).not.toBeInTheDocument()
  })

  it('renders note content inside the open drawer', () => {
    render(<NotesDrawer {...defaultProps} />)
    fireEvent.click(screen.getByTitle('Open notes'))
    expect(screen.getByText('This is a test note')).toBeInTheDocument()
  })

  it('renders the pin button inside the open drawer', () => {
    render(<NotesDrawer {...defaultProps} />)
    fireEvent.click(screen.getByTitle('Open notes'))
    expect(screen.getByTitle('Pin open')).toBeInTheDocument()
  })

  it('toggling pin calls onPinnedChange with true when pinning while open', () => {
    const onPinnedChange = vi.fn()
    render(<NotesDrawer {...defaultProps} onPinnedChange={onPinnedChange} />)
    fireEvent.click(screen.getByTitle('Open notes'))
    fireEvent.click(screen.getByTitle('Pin open'))
    expect(onPinnedChange).toHaveBeenCalledWith(true)
  })

  it('shows Unpin title when already pinned', () => {
    const onPinnedChange = vi.fn()
    render(<NotesDrawer {...defaultProps} onPinnedChange={onPinnedChange} />)
    fireEvent.click(screen.getByTitle('Open notes'))
    fireEvent.click(screen.getByTitle('Pin open'))
    expect(screen.getByTitle('Unpin')).toBeInTheDocument()
  })

  it('renders NoteComments for each note', () => {
    render(<NotesDrawer {...defaultProps} />)
    fireEvent.click(screen.getByTitle('Open notes'))
    expect(screen.getByTestId('note-comments-note-1')).toBeInTheDocument()
  })

  it('renders archive toggle when notes have archived items', () => {
    const archivedNote: Note = { ...mockNote, id: 'note-2', is_archived: true }
    render(<NotesDrawer {...defaultProps} notes={[mockNote, archivedNote]} />)
    fireEvent.click(screen.getByTitle('Open notes'))
    expect(screen.getByText(/Show archived/)).toBeInTheDocument()
  })

  it('calls onToggleArchivedNotes when archive toggle is clicked', () => {
    const onToggle = vi.fn()
    const archivedNote: Note = { ...mockNote, id: 'note-2', is_archived: true }
    render(<NotesDrawer {...defaultProps} notes={[mockNote, archivedNote]} onToggleArchivedNotes={onToggle} />)
    fireEvent.click(screen.getByTitle('Open notes'))
    fireEvent.click(screen.getByText(/Show archived/))
    expect(onToggle).toHaveBeenCalled()
  })
})
