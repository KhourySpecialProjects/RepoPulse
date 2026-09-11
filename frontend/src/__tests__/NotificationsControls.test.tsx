import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { NotificationsPage } from '@/pages/NotificationsPage'
import type { Notification, Reminder, RecentlyDeletedItem, UserDetail } from '@/types'

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'user-mark', display_name: 'Mark', role: 'instructor' as const },
    isAuthenticated: true,
    isLoading: false,
    login: () => Promise.resolve(),
    devLogin: () => Promise.resolve(),
    logout: () => {},
  }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}))

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

const users: UserDetail[] = [
  {
    id: 'user-mark',
    email: 'mark@example.com',
    display_name: 'Mark',
    role: 'instructor',
    github_token_configured: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'user-ta-one',
    email: 'ta1@example.com',
    display_name: 'TA One',
    role: 'ta',
    github_token_configured: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'user-ta-two',
    email: 'ta2@example.com',
    display_name: 'TA Two',
    role: 'ta',
    github_token_configured: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
]

const reminderOf = (id: string, over: Partial<Reminder> = {}): Reminder => ({
  id,
  content: `Reminder ${id}`,
  remind_at: '2099-01-01T10:00:00Z',
  reminder_context: null,
  repo_id: 'repo-1',
  commit_hash: null,
  created_at: '2026-09-01T10:00:00Z',
  owner_display_name: 'Mark',
  shared_with: [],
  is_owner: true,
  ...over,
})

const notifOf = (
  id: string,
  over: Partial<Notification> = {}
): Notification => ({
  id,
  type: 'mention',
  note_id: 'note-1',
  comment_id: null,
  is_read: false,
  created_at: '2026-09-11T11:00:00Z',
  note_content_preview: `Preview ${id}`,
  repo_id: 'repo-1',
  ...over,
})

type Calls = {
  unread: string[]
  markAllUnread: number
  created: Record<string, unknown>[]
}

function setup(opts?: {
  items?: Notification[]
  reminders?: Reminder[]
  deleted?: RecentlyDeletedItem[]
}) {
  const calls: Calls = { unread: [], markAllUnread: 0, created: [] }
  const items = opts?.items ?? []
  const reminders = opts?.reminders ?? []
  const deleted = opts?.deleted ?? []

  server.use(
    http.get('/api/v1/users', () => HttpResponse.json({ items: users, total: users.length })),
    http.get('/api/v1/notifications', () =>
      HttpResponse.json({
        items,
        total: items.length,
        unread_count: items.filter((n) => !n.is_read).length,
      })
    ),
    http.get('/api/v1/notifications/unread-count', () =>
      HttpResponse.json({ unread_count: items.filter((n) => !n.is_read).length })
    ),
    http.get('/api/v1/notifications/reminders', () =>
      HttpResponse.json({ items: reminders, total: reminders.length })
    ),
    http.get('/api/v1/notifications/recently-deleted', () =>
      HttpResponse.json({ items: deleted, total: deleted.length })
    ),
    http.patch('/api/v1/notifications/:id/unread', ({ params }) => {
      calls.unread.push(String(params.id))
      return HttpResponse.json({ ...notifOf(String(params.id)), is_read: false })
    }),
    http.patch('/api/v1/notifications/:id/read', ({ params }) =>
      HttpResponse.json({ ...notifOf(String(params.id)), is_read: true })
    ),
    http.post('/api/v1/notifications/mark-all-unread', () => {
      calls.markAllUnread += 1
      return HttpResponse.json({ marked_unread: items.length })
    }),
    http.post('/api/v1/notifications/mark-all-read', () =>
      HttpResponse.json({ marked_read: items.length })
    ),
    http.post('/api/v1/notes', async ({ request }) => {
      calls.created.push((await request.json()) as Record<string, unknown>)
      return HttpResponse.json({ id: 'new-note' }, { status: 201 })
    }),
    http.delete('/api/v1/notes/:id', () => new HttpResponse(null, { status: 204 }))
  )
  return calls
}

function renderPage() {
  return render(
    <QueryClientProvider client={makeClient()}>
      <MemoryRouter initialEntries={['/notifications']}>
        <NotificationsPage />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

beforeEach(() => localStorage.clear())

// ──────────────────────────────────────────────
// 1. Marking things unread again
// ──────────────────────────────────────────────
describe('Notifications — marking unread', () => {
  it('offers an unread control on a read notification', async () => {
    setup({ items: [notifOf('n1', { is_read: true })] })
    renderPage()

    expect(await screen.findByTitle('Mark as unread')).toBeInTheDocument()
  })

  it('marks a read notification unread again', async () => {
    const calls = setup({ items: [notifOf('n1', { is_read: true })] })
    renderPage()

    fireEvent.click(await screen.findByTitle('Mark as unread'))

    await waitFor(() => expect(calls.unread).toEqual(['n1']))
  })

  it('offers a read control on an unread notification', async () => {
    setup({ items: [notifOf('n1', { is_read: false })] })
    renderPage()

    expect(await screen.findByTitle('Mark as read')).toBeInTheDocument()
  })

  it('has an Unread all button when something has been read', async () => {
    const calls = setup({ items: [notifOf('n1', { is_read: true })] })
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: /unread all/i }))

    await waitFor(() => expect(calls.markAllUnread).toBe(1))
  })

  it('hides Unread all when nothing has been read', async () => {
    setup({ items: [notifOf('n1', { is_read: false })] })
    renderPage()

    await screen.findByText('You were mentioned')
    expect(screen.queryByRole('button', { name: /unread all/i })).not.toBeInTheDocument()
  })
})

// ──────────────────────────────────────────────
// 2. Active reminders must not repeat in Recent activity
// ──────────────────────────────────────────────
describe('Recent activity — no duplicate reminders', () => {
  it('hides a fired reminder that is still in Active reminders', async () => {
    setup({
      items: [notifOf('n-rem', { type: 'reminder', note_id: 'rem-1' })],
      reminders: [reminderOf('rem-1')],
    })
    renderPage()

    await screen.findByText('Reminder rem-1')
    expect(screen.queryByText('Reminder due')).not.toBeInTheDocument()
  })

  it('still shows a fired reminder once its reminder is gone', async () => {
    setup({
      items: [notifOf('n-rem', { type: 'reminder', note_id: 'rem-1' })],
      reminders: [],
    })
    renderPage()

    expect(await screen.findByText('Reminder due')).toBeInTheDocument()
  })

  it('keeps mentions in Recent activity', async () => {
    setup({ items: [notifOf('n1')], reminders: [reminderOf('rem-1')] })
    renderPage()

    expect(await screen.findByText('You were mentioned')).toBeInTheDocument()
  })
})

// ──────────────────────────────────────────────
// 3. Sharing a reminder with other people
// ──────────────────────────────────────────────
describe('Reminders — sharing with others', () => {
  it('lets you tag other users when creating a reminder', async () => {
    const calls = setup({ reminders: [] })
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: /new reminder/i }))
    fireEvent.change(screen.getByPlaceholderText(/remind me to/i), {
      target: { value: 'Grade finals together' },
    })
    fireEvent.click(await screen.findByLabelText('Share with TA One'))
    fireEvent.click(screen.getByLabelText('Share with TA Two'))
    fireEvent.click(screen.getByRole('button', { name: 'Add reminder' }))

    await waitFor(() => expect(calls.created).toHaveLength(1))
    expect(calls.created[0].shared_with).toEqual(['user-ta-one', 'user-ta-two'])
    expect(calls.created[0].is_reminder).toBe(true)
  })

  it('does not offer to share a reminder with yourself', async () => {
    setup({ reminders: [] })
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: /new reminder/i }))

    await screen.findByLabelText('Share with TA One')
    expect(screen.queryByLabelText('Share with Mark')).not.toBeInTheDocument()
  })

  it('creates an undated reminder without requiring a due date', async () => {
    const calls = setup({ reminders: [] })
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: /new reminder/i }))
    fireEvent.change(screen.getByPlaceholderText(/remind me to/i), {
      target: { value: 'No date needed' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add reminder' }))

    await waitFor(() => expect(calls.created).toHaveLength(1))
    expect(calls.created[0].remind_at).toBeNull()
  })

  it('labels the due date as optional', async () => {
    setup({ reminders: [] })
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: /new reminder/i }))

    expect(await screen.findByText(/optional/i)).toBeInTheDocument()
  })

  it('shows who a shared reminder is shared with', async () => {
    setup({ reminders: [reminderOf('rem-1', { shared_with: ['TA One', 'TA Two'] })] })
    renderPage()

    expect(await screen.findByText(/TA One, TA Two/)).toBeInTheDocument()
  })

  it('marks a reminder someone else shared with you', async () => {
    setup({
      reminders: [
        reminderOf('rem-1', { is_owner: false, owner_display_name: 'Sarah TA' }),
      ],
    })
    renderPage()

    expect(await screen.findByText(/Sarah TA/)).toBeInTheDocument()
  })
})

// ──────────────────────────────────────────────
// 4. Controls are big enough to hit
// ──────────────────────────────────────────────
describe('Notifications — control sizing', () => {
  const BIG = /p-2(\.5)?\b|px-3\b/

  it('gives the reminder delete control a larger hit area', async () => {
    setup({ reminders: [reminderOf('rem-1')] })
    renderPage()

    const btn = await screen.findByTitle('Remove reminder')
    expect(btn.className).toMatch(BIG)
    expect(btn.querySelector('svg')?.getAttribute('class') ?? '').toMatch(/h-5/)
  })

  it('gives the notification delete control a larger hit area', async () => {
    setup({ items: [notifOf('n1')] })
    renderPage()

    const btn = await screen.findByTitle('Remove notification')
    expect(btn.className).toMatch(BIG)
  })

  it('labels the new reminder control instead of using a bare icon', async () => {
    setup({ reminders: [] })
    renderPage()

    const btn = await screen.findByRole('button', { name: /new reminder/i })
    expect(btn.textContent).toMatch(/new reminder/i)
  })

  it('gives the recently deleted controls a larger hit area', async () => {
    setup({
      deleted: [
        {
          id: 'gone-1',
          kind: 'notification',
          label: 'Mention',
          detail: 'Dismissed',
          deleted_at: '2026-09-11T12:00:00Z',
        },
      ],
    })
    renderPage()

    const restore = await screen.findByTitle('Restore Mention')
    const purge = screen.getByTitle('Delete Mention forever')
    expect(restore.className).toMatch(BIG)
    expect(purge.className).toMatch(BIG)
  })
})
