import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NoteForm } from '@/components/NoteForm'

describe('NoteForm', () => {
  it('renders textarea and submit button', () => {
    render(<NoteForm onSubmit={vi.fn()} />)
    expect(screen.getByPlaceholderText('Write a note... use @ to mention a user')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save Note' })).toBeInTheDocument()
  })

  it('does not submit when content is empty', async () => {
    const onSubmit = vi.fn()
    render(<NoteForm onSubmit={onSubmit} />)
    fireEvent.click(screen.getByRole('button', { name: 'Save Note' }))
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('calls onSubmit with content when form is submitted', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<NoteForm onSubmit={onSubmit} />)
    await user.type(screen.getByPlaceholderText('Write a note... use @ to mention a user'), 'My test note')
    await user.click(screen.getByRole('button', { name: 'Save Note' }))
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'My test note', is_reminder: false })
    )
  })

  it('shows reminder context field when reminder checkbox is checked', async () => {
    const user = userEvent.setup()
    render(<NoteForm onSubmit={vi.fn()} />)
    expect(screen.queryByPlaceholderText(/reminder context/i)).not.toBeInTheDocument()
    await user.click(screen.getByRole('checkbox'))
    expect(screen.getByPlaceholderText('Reminder context (optional)')).toBeInTheDocument()
  })

  it('renders custom submitLabel', () => {
    render(<NoteForm onSubmit={vi.fn()} submitLabel="Update Note" />)
    expect(screen.getByRole('button', { name: 'Update Note' })).toBeInTheDocument()
  })

  it('populates initial values', () => {
    render(
      <NoteForm
        onSubmit={vi.fn()}
        initialValues={{ content: 'Existing note', is_reminder: false }}
      />
    )
    expect(screen.getByPlaceholderText('Write a note... use @ to mention a user')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Existing note')).toBeInTheDocument()
  })

  it('shows loading state', () => {
    render(<NoteForm onSubmit={vi.fn()} isLoading />)
    expect(screen.getByRole('button', { name: 'Saving...' })).toBeDisabled()
  })

  it('submits reminder_context when is_reminder is set', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<NoteForm onSubmit={onSubmit} />)
    await user.type(screen.getByPlaceholderText('Write a note... use @ to mention a user'), 'Check in')
    await user.click(screen.getByRole('checkbox'))
    await user.type(screen.getByPlaceholderText('Reminder context (optional)'), 'After midterm')
    await user.click(screen.getByRole('button', { name: 'Save Note' }))
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        content: 'Check in',
        is_reminder: true,
        reminder_context: 'After midterm',
        // No due date chosen, so the reminder is saved without one
        remind_at: null,
      })
    })
  })
})
