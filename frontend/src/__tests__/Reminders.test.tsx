import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { NoteForm } from '@/components/NoteForm'
import { ActiveRemindersPanel } from '@/components/ActiveRemindersPanel'
import { formatReminderCountdown } from '@/lib/reminders'
import type { Reminder } from '@/types'

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
// 3. ActiveRemindersPanel (rendered on the notifications page)
// ──────────────────────────────────────────────
const futureReminder: Reminder = {
  id: 'rem-1',
  content: 'Review Bob PR',
  remind_at: '2099-01-01T10:00:00Z',
  reminder_context: null,
  repo_id: 'repo-1',
  commit_hash: null,
  created_at: '2026-09-01T10:00:00Z',
  owner_display_name: 'Mark',
  shared_with: [],
  is_owner: true,
}

const overdueReminder: Reminder = {
  ...futureReminder,
  id: 'rem-2',
  content: 'Chase missing submission',
  remind_at: '2020-01-01T10:00:00Z',
}

function setupReminderHandlers(opts?: {
  reminders?: Reminder[]
  onDelete?: (id: string) => void
  onCreate?: (body: unknown) => void
}) {
  const reminders = opts?.reminders ?? []
  server.use(
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

function renderPanel() {
  return render(
    <QueryClientProvider client={makeClient()}>
      <MemoryRouter>
        <ActiveRemindersPanel />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('ActiveRemindersPanel', () => {
  beforeEach(() => localStorage.clear())

  it('lists active reminders with a countdown', async () => {
    setupReminderHandlers({ reminders: [futureReminder] })
    renderPanel()

    expect(await screen.findByText('Review Bob PR')).toBeInTheDocument()
    expect(screen.getByText(/in \d+d/)).toBeInTheDocument()
  })

  it('flags an overdue reminder', async () => {
    setupReminderHandlers({ reminders: [overdueReminder] })
    renderPanel()

    expect(await screen.findByText('Chase missing submission')).toBeInTheDocument()
    expect(screen.getByText(/overdue/i)).toBeInTheDocument()
  })

  it('shows an empty state when there are no active reminders', async () => {
    setupReminderHandlers({ reminders: [] })
    renderPanel()

    expect(await screen.findByText(/no active reminders/i)).toBeInTheDocument()
  })

  it('removes a reminder via its delete control', async () => {
    const onDelete = vi.fn()
    setupReminderHandlers({ reminders: [futureReminder], onDelete })
    renderPanel()

    await screen.findByText('Review Bob PR')
    fireEvent.click(screen.getByTitle('Remove reminder'))

    await waitFor(() => expect(onDelete).toHaveBeenCalledWith('rem-1'))
  })

  it('creates a reminder with content and due date', async () => {
    const onCreate = vi.fn()
    setupReminderHandlers({ reminders: [], onCreate })
    renderPanel()

    fireEvent.click(await screen.findByRole('button', { name: /new reminder/i }))
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
    setupReminderHandlers({ reminders: [], onCreate })
    renderPanel()

    fireEvent.click(await screen.findByRole('button', { name: /new reminder/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Add reminder' }))

    expect(onCreate).not.toHaveBeenCalled()
  })
})
