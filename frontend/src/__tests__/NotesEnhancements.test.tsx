import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NoteForm } from '@/components/NoteForm'
import type { UserDetail } from '@/types'

const mockUsers: UserDetail[] = [
  { id: 'u-1', display_name: 'Alice Johnson', email: 'alice@example.com', role: 'instructor', github_token_configured: false, created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-01T00:00:00Z' },
  { id: 'u-2', display_name: 'Bob Smith', email: 'bob@example.com', role: 'ta', github_token_configured: false, created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-01T00:00:00Z' },
  { id: 'u-3', display_name: 'Carol Davis', email: 'carol@example.com', role: 'instructor', github_token_configured: false, created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-01T00:00:00Z' },
]

describe('NoteForm — @mention autocomplete', () => {
  it('renders with updated placeholder text', () => {
    render(<NoteForm onSubmit={vi.fn()} />)
    expect(screen.getByPlaceholderText('Write a note... use @ to mention a user')).toBeInTheDocument()
  })

  it('does not show mention dropdown when no @ is typed', () => {
    render(<NoteForm onSubmit={vi.fn()} users={mockUsers} />)
    fireEvent.change(screen.getByPlaceholderText('Write a note... use @ to mention a user'), {
      target: { value: 'hello world', selectionStart: 11 },
    })
    expect(screen.queryByText('@Alice Johnson')).not.toBeInTheDocument()
  })

  it('shows mention dropdown when @ is typed', async () => {
    const user = userEvent.setup()
    render(<NoteForm onSubmit={vi.fn()} users={mockUsers} />)
    await user.type(screen.getByPlaceholderText('Write a note... use @ to mention a user'), '@')
    expect(screen.getByText('@Alice Johnson')).toBeInTheDocument()
    expect(screen.getByText('@Bob Smith')).toBeInTheDocument()
    expect(screen.getByText('@Carol Davis')).toBeInTheDocument()
  })

  it('filters mention dropdown based on typed text', async () => {
    const user = userEvent.setup()
    render(<NoteForm onSubmit={vi.fn()} users={mockUsers} />)
    await user.type(screen.getByPlaceholderText('Write a note... use @ to mention a user'), '@ali')
    expect(screen.getByText('@Alice Johnson')).toBeInTheDocument()
    expect(screen.queryByText('@Bob Smith')).not.toBeInTheDocument()
  })

  it('inserts mention slug when user is selected', async () => {
    const user = userEvent.setup()
    render(<NoteForm onSubmit={vi.fn()} users={mockUsers} />)
    const textarea = screen.getByPlaceholderText('Write a note... use @ to mention a user')
    await user.type(textarea, '@ali')
    fireEvent.mouseDown(screen.getByText('@Alice Johnson'))
    expect((textarea as HTMLTextAreaElement).value).toContain('@Alice_Johnson')
  })

  it('hides dropdown after selecting a user', async () => {
    const user = userEvent.setup()
    render(<NoteForm onSubmit={vi.fn()} users={mockUsers} />)
    await user.type(screen.getByPlaceholderText('Write a note... use @ to mention a user'), '@ali')
    fireEvent.mouseDown(screen.getByText('@Alice Johnson'))
    expect(screen.queryByText('@Alice Johnson')).not.toBeInTheDocument()
  })

  it('closes dropdown on Escape key', async () => {
    const user = userEvent.setup()
    render(<NoteForm onSubmit={vi.fn()} users={mockUsers} />)
    await user.type(screen.getByPlaceholderText('Write a note... use @ to mention a user'), '@')
    expect(screen.getByText('@Alice Johnson')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByText('@Alice Johnson')).not.toBeInTheDocument()
  })

  it('does not show dropdown when users prop is empty', async () => {
    const user = userEvent.setup()
    render(<NoteForm onSubmit={vi.fn()} users={[]} />)
    await user.type(screen.getByPlaceholderText('Write a note... use @ to mention a user'), '@')
    // No dropdown items should appear
    expect(screen.queryByRole('button', { name: /@/ })).not.toBeInTheDocument()
  })

  it('accepts users prop without failing when undefined', () => {
    expect(() => render(<NoteForm onSubmit={vi.fn()} />)).not.toThrow()
  })
})

describe('NoteForm — reminder context placeholder', () => {
  it('shows reminder context with generic placeholder', async () => {
    const user = userEvent.setup()
    render(<NoteForm onSubmit={vi.fn()} />)
    await user.click(screen.getByRole('checkbox'))
    expect(screen.getByPlaceholderText('Reminder context (optional)')).toBeInTheDocument()
  })
})

describe('NoteForm — is_checked / is_archived fields in Note type', () => {
  it('submits form with content and reminder state', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<NoteForm onSubmit={onSubmit} users={mockUsers} />)
    await user.type(screen.getByPlaceholderText('Write a note... use @ to mention a user'), 'Team check-in')
    await user.click(screen.getByRole('button', { name: 'Save Note' }))
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ content: 'Team check-in', is_reminder: false })
      )
    })
  })

  it('clears content after successful submit', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<NoteForm onSubmit={onSubmit} users={mockUsers} />)
    const textarea = screen.getByPlaceholderText('Write a note... use @ to mention a user')
    await user.type(textarea, 'Test note')
    await user.click(screen.getByRole('button', { name: 'Save Note' }))
    await waitFor(() => {
      expect((textarea as HTMLTextAreaElement).value).toBe('')
    })
  })
})
