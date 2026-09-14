/**
 * Mentions in comments.
 *
 * The backend has always raised mention notifications for comment bodies
 * (`create_mention_notifications(..., comment_id=...)`), but the comment box
 * had no @ autocomplete, so the only way to be mentioned in a reply was to
 * type the slug by hand. These tests pin the UI that closes that gap.
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NoteComments } from '@/components/NoteComments'
import { mentionSlug } from '@/hooks/useMentions'
import type { Note, UserDetail } from '@/types'

const createNoteComment = vi.fn()

vi.mock('@/services/api', () => ({
  getNoteComments: () => Promise.resolve([]),
  createNoteComment: (...args: unknown[]) => createNoteComment(...args),
  deleteNoteComment: () => Promise.resolve(),
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const note: Note = {
  id: 'note-1',
  repo_id: 'repo-1',
  contributor_id: null,
  author_id: 'user-1',
  author_display_name: 'Prof Owner',
  content: 'Initial note',
  commit_hash: null,
  is_reminder: false,
  reminder_context: null,
  remind_at: null,
  is_checked: false,
  is_archived: false,
  created_at: '2026-09-01T10:00:00Z',
  updated_at: '2026-09-01T10:00:00Z',
} as Note

const users: UserDetail[] = [
  {
    id: 'user-2',
    email: 'dana@example.edu',
    display_name: 'Dana TA',
    role: 'ta',
    created_at: '2026-09-01T10:00:00Z',
    updated_at: '2026-09-01T10:00:00Z',
  } as UserDetail,
  {
    id: 'user-3',
    email: 'mark@example.edu',
    display_name: 'Mark (Instructor)',
    role: 'instructor',
    created_at: '2026-09-01T10:00:00Z',
    updated_at: '2026-09-01T10:00:00Z',
  } as UserDetail,
]

function renderComments() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <NoteComments note={note} currentUserId="user-1" users={users} />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  createNoteComment.mockResolvedValue({
    id: 'c-1',
    note_id: 'note-1',
    author_id: 'user-1',
    author_display_name: 'Prof Owner',
    content: 'ok',
    created_at: '2026-09-01T11:00:00Z',
  })
})

describe('mentions in comments', () => {
  it('suggests users after an @ in the reply box', async () => {
    renderComments()
    await userEvent.click(await screen.findByRole('button', { name: 'Reply' }))

    await userEvent.type(screen.getByPlaceholderText(/use @ to mention/), 'ping @Dan')

    expect(await screen.findByRole('option', { name: '@Dana TA' })).toBeInTheDocument()
    // The non-matching user must not be offered.
    expect(
      screen.queryByRole('option', { name: '@Mark (Instructor)' })
    ).not.toBeInTheDocument()
  })

  it('inserts the backend-compatible slug when a suggestion is chosen', async () => {
    renderComments()
    await userEvent.click(await screen.findByRole('button', { name: 'Reply' }))
    const box = screen.getByPlaceholderText(/use @ to mention/) as HTMLTextAreaElement

    await userEvent.type(box, 'ping @Dan')
    await userEvent.click(await screen.findByRole('option', { name: '@Dana TA' }))

    // Spaces become underscores, matching slug_for_display_name on the backend.
    expect(box.value).toBe('ping @Dana_TA ')
  })

  it('submits the comment body containing the mention', async () => {
    renderComments()
    await userEvent.click(await screen.findByRole('button', { name: 'Reply' }))
    const box = screen.getByPlaceholderText(/use @ to mention/)

    await userEvent.type(box, 'over to you @Dan')
    await userEvent.click(await screen.findByRole('option', { name: '@Dana TA' }))
    await userEvent.click(screen.getByRole('button', { name: 'Reply' }))

    await waitFor(() =>
      expect(createNoteComment).toHaveBeenCalledWith('note-1', 'over to you @Dana_TA')
    )
  })

  it('closes the suggestions on Escape', async () => {
    renderComments()
    await userEvent.click(await screen.findByRole('button', { name: 'Reply' }))
    const box = screen.getByPlaceholderText(/use @ to mention/)

    await userEvent.type(box, '@Dan')
    expect(await screen.findByRole('option', { name: '@Dana TA' })).toBeInTheDocument()

    await userEvent.type(box, '{Escape}')

    expect(
      screen.queryByRole('option', { name: '@Dana TA' })
    ).not.toBeInTheDocument()
  })

  it('stops suggesting once the token is ended by a space', async () => {
    renderComments()
    await userEvent.click(await screen.findByRole('button', { name: 'Reply' }))

    await userEvent.type(screen.getByPlaceholderText(/use @ to mention/), '@Dana said')

    expect(
      screen.queryByRole('option', { name: '@Dana TA' })
    ).not.toBeInTheDocument()
  })
})

describe('mentionSlug', () => {
  it('matches the backend slug rules', () => {
    expect(mentionSlug('Dana TA')).toBe('Dana_TA')
    // Punctuation is preserved; the backend matches on the full slug.
    expect(mentionSlug('Mark (Instructor)')).toBe('Mark_(Instructor)')
    expect(mentionSlug('Solo')).toBe('Solo')
  })
})
