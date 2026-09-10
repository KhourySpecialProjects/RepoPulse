import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { NoteForm } from '@/components/NoteForm'
import { AppSidebar } from '@/components/AppSidebar'
import { SidebarContext } from '@/contexts/SidebarContext'
import { formatReminderCountdown } from '@/lib/reminders'
import type { Reminder, Notification } from '@/types'

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'user-instructor-1', display_name: 'Mark', role: 'instructor' as const },
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

// ──────────────────────────────────────────────
// 1. Countdown formatting
// ──────────────────────────────────────────────
describe('formatReminderCountdown', () => {
  const now = new Date('2026-09-10T12:00:00Z')

  it('describes reminders due in the future', () => {
    expect(formatReminderCountdown('2026-09-10T14:00:00Z', now)).toBe('in 2h')
    expect(formatReminderCountdown('2026-09-10T12:30:00Z', now)).toBe('in 30m')
    expect(formatReminderCountdown('2026-09-13T12:00:00Z', now)).toBe('in 3d')
  })

  it('describes reminders that are already due as overdue', () => {
    expect(formatReminderCountdown('2026-09-10T11:30:00Z', now)).toBe('30m overdue')
    expect(formatReminderCountdown('2026-09-09T12:00:00Z', now)).toBe('1d overdue')
  })

  it('treats the current minute as due now', () => {
    expect(formatReminderCountdown('2026-09-10T12:00:00Z', now)).toBe('due now')
  })

  it('reports reminders with no due date', () => {
    expect(formatReminderCountdown(null, now)).toBe('No due date')
  })
})

// ──────────────────────────────────────────────
// 2. NoteForm reminder due-date picker
// ──────────────────────────────────────────────
describe('NoteForm — reminder due date', () => {
  it('hides the due-date picker until Reminder is checked', () => {
    render(<NoteForm onSubmit={vi.fn()} />)
    expect(screen.queryByLabelText(/remind me at/i)).not.toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Reminder'))

    expect(screen.getByLabelText(/remind me at/i)).toBeInTheDocument()
  })

  it('submits the chosen due date as an ISO remind_at', () => {
    const onSubmit = vi.fn()
    render(<NoteForm onSubmit={onSubmit} />)

    fireEvent.change(screen.getByPlaceholderText(/write a note/i), {
      target: { value: 'Grade midterms' },
    })
    fireEvent.click(screen.getByLabelText('Reminder'))
    fireEvent.change(screen.getByLabelText(/remind me at/i), {
      target: { value: '2026-12-01T09:30' },
    })
    fireEvent.submit(screen.getByRole('button', { name: /save note/i }))

    expect(onSubmit).toHaveBeenCalledTimes(1)
    const values = onSubmit.mock.calls[0][0]
    expect(values.is_reminder).toBe(true)
    expect(values.remind_at).toBe(new Date('2026-12-01T09:30').toISOString())
  })

  it('submits a null remind_at when no due date is chosen', () => {
    const onSubmit = vi.fn()
    render(<NoteForm onSubmit={onSubmit} />)

    fireEvent.change(screen.getByPlaceholderText(/write a note/i), {
      target: { value: 'Some reminder' },
    })
    fireEvent.click(screen.getByLabelText('Reminder'))
    fireEvent.submit(screen.getByRole('button', { name: /save note/i }))

    expect(onSubmit.mock.calls[0][0].remind_at).toBeNull()
  })

  it('does not send remind_at for a plain note', () => {
    const onSubmit = vi.fn()
    render(<NoteForm onSubmit={onSubmit} />)

    fireEvent.change(screen.getByPlaceholderText(/write a note/i), {
      target: { value: 'Just a note' },
    })
    fireEvent.submit(screen.getByRole('button', { name: /save note/i }))

    const values = onSubmit.mock.calls[0][0]
    expect(values.is_reminder).toBe(false)
    expect(values.remind_at).toBeNull()
  })
})

// ──────────────────────────────────────────────
// 3. Notification dropdown: reminders panel
// ──────────────────────────────────────────────
const futureReminder: Reminder = {
  id: 'rem-1',
  content: 'Review Bob PR',
  remind_at: '2099-01-01T10:00:00Z',
  reminder_context: null,
  repo_id: 'repo-1',
  commit_hash: null,
  created_at: '2026-09-01T10:00:00Z',
}

const mentionNotification: Notification = {
  id: 'notif-1',
  type: 'mention',
  note_id: 'note-1',
  comment_id: null,
  is_read: false,
  created_at: '2026-09-10T11:00:00Z',
  note_content_preview: 'Hey @Mark can you check this',
  repo_id: 'repo-1',
}

const reminderNotification: Notification = {
  id: 'notif-2',
  type: 'reminder',
  note_id: 'rem-1',
  comment_id: null,
  is_read: false,
  created_at: '2026-09-10T11:30:00Z',
  note_content_preview: 'Review Bob PR',
  repo_id: 'repo-1',
}

function setupNotificationHandlers(opts?: {
  notifications?: Notification[]
  reminders?: Reminder[]
  onDelete?: (id: string) => void
  onCreate?: (body: unknown) => void
}) {
  const notifications = opts?.notifications ?? []
  const reminders = opts?.reminders ?? []
  server.use(
    http.get('/api/v1/notifications', () =>
      HttpResponse.json({
        items: notifications,
        total: notifications.length,
        unread_count: notifications.filter((n) => !n.is_read).length,
      })
    ),
    http.get('/api/v1/notifications/unread-count', () =>
      HttpResponse.json({ unread_count: notifications.filter((n) => !n.is_read).length })
    ),
    http.get('/api/v1/notifications/reminders', () =>
      HttpResponse.json({ items: reminders, total: reminders.length })
    ),
    http.post('/api/v1/notes', async ({ request }) => {
      opts?.onCreate?.(await request.json())
      return HttpResponse.json({ id: 'new-note' }, { status: 201 })
    }),
    http.delete('/api/v1/notes/:id', ({ params }) => {
      opts?.onDelete?.(String(params.id))
      return new HttpResponse(null, { status: 204 })
    })
  )
}

function renderSidebar() {
  return render(
    <QueryClientProvider client={makeClient()}>
      <MemoryRouter initialEntries={['/collections']}>
        <SidebarContext.Provider
          value={{ collapsed: false, setCollapsed: () => {}, width: 220, setWidth: () => {} }}
        >
          <AppSidebar />
        </SidebarContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

async function openNotifications() {
  renderSidebar()
  fireEvent.click(await screen.findByRole('button', { name: /notifications/i }))
  // 'Active reminders' is unique to the dropdown; 'Notifications' also matches
  // the sidebar nav button that opened it.
  await waitFor(() => expect(screen.getByText(/active reminders/i)).toBeInTheDocument())
}

describe('NotificationDropdown — reminder notifications', () => {
  beforeEach(() => localStorage.clear())

  it('labels a fired reminder distinctly from a mention', async () => {
    setupNotificationHandlers({ notifications: [mentionNotification, reminderNotification] })
    await openNotifications()

    expect(await screen.findByText('Reminder due')).toBeInTheDocument()
    expect(screen.getByText('You were mentioned')).toBeInTheDocument()
  })
})

describe('NotificationDropdown — active reminders panel', () => {
  beforeEach(() => localStorage.clear())

  it('lists active reminders with a countdown', async () => {
    setupNotificationHandlers({ reminders: [futureReminder] })
    await openNotifications()

    expect(await screen.findByText('Review Bob PR')).toBeInTheDocument()
    expect(screen.getByText(/in \d+d/)).toBeInTheDocument()
  })

  it('shows an empty state when there are no active reminders', async () => {
    setupNotificationHandlers({ reminders: [] })
    await openNotifications()

    expect(await screen.findByText(/no active reminders/i)).toBeInTheDocument()
  })

  it('removes a reminder via its delete control', async () => {
    const onDelete = vi.fn()
    setupNotificationHandlers({ reminders: [futureReminder], onDelete })
    await openNotifications()

    await screen.findByText('Review Bob PR')
    fireEvent.click(screen.getByTitle('Remove reminder'))

    await waitFor(() => expect(onDelete).toHaveBeenCalledWith('rem-1'))
  })

  it('creates a reminder from the panel with content and due date', async () => {
    const onCreate = vi.fn()
    setupNotificationHandlers({ reminders: [], onCreate })
    await openNotifications()

    fireEvent.click(await screen.findByTitle('New reminder'))
    fireEvent.change(screen.getByPlaceholderText(/remind me to/i), {
      target: { value: 'Email the class' },
    })
    fireEvent.change(screen.getByLabelText(/due/i), {
      target: { value: '2026-12-24T08:00' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add reminder' }))

    await waitFor(() => expect(onCreate).toHaveBeenCalled())
    const body = onCreate.mock.calls[0][0] as Record<string, unknown>
    expect(body.content).toBe('Email the class')
    expect(body.is_reminder).toBe(true)
    expect(body.remind_at).toBe(new Date('2026-12-24T08:00').toISOString())
  })

  it('will not create a reminder with empty content', async () => {
    const onCreate = vi.fn()
    setupNotificationHandlers({ reminders: [], onCreate })
    await openNotifications()

    fireEvent.click(await screen.findByTitle('New reminder'))
    fireEvent.click(screen.getByRole('button', { name: 'Add reminder' }))

    expect(onCreate).not.toHaveBeenCalled()
  })
})
