import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { NotificationsPage } from '@/pages/NotificationsPage'
import type { Notification, Reminder, RecentlyDeletedItem } from '@/types'

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

const mention: Notification = {
  id: 'n1',
  type: 'mention',
  note_id: 'note-1',
  comment_id: null,
  is_read: false,
  created_at: '2026-09-11T11:00:00Z',
  note_content_preview: 'Hey @Mark take a look',
  repo_id: 'repo-1',
}

const reminder: Reminder = {
  id: 'rem-1',
  content: 'Review Bob PR',
  remind_at: '2099-01-01T10:00:00Z',
  reminder_context: null,
  repo_id: 'repo-1',
  commit_hash: null,
  created_at: '2026-09-01T10:00:00Z',
}

const deletedNotification: RecentlyDeletedItem = {
  id: 'n1',
  kind: 'notification',
  label: 'Mention',
  // Distinct from the live notification's preview so text queries stay unambiguous
  detail: 'Dismissed mention about the parser',
  deleted_at: '2026-09-11T12:00:00Z',
}

const deletedReminder: RecentlyDeletedItem = {
  id: 'rem-9',
  kind: 'reminder',
  label: 'Reminder',
  detail: 'Chase missing submission',
  deleted_at: '2026-09-11T12:30:00Z',
}

type Calls = {
  dismissed: string[]
  restoredNotif: string[]
  purgedNotif: string[]
  restoredNote: string[]
  purgedNote: string[]
  navigatedAway: boolean
}

function setup(opts?: {
  items?: Notification[]
  reminders?: Reminder[]
  deleted?: RecentlyDeletedItem[]
}) {
  const calls: Calls = {
    dismissed: [],
    restoredNotif: [],
    purgedNotif: [],
    restoredNote: [],
    purgedNote: [],
    navigatedAway: false,
  }
  const items = opts?.items ?? [mention]
  const reminders = opts?.reminders ?? [reminder]
  const deleted = opts?.deleted ?? []

  server.use(
    http.get('/api/v1/notifications', () =>
      HttpResponse.json({ items, total: items.length, unread_count: 1 })
    ),
    http.get('/api/v1/notifications/unread-count', () =>
      HttpResponse.json({ unread_count: 1 })
    ),
    http.get('/api/v1/notifications/reminders', () =>
      HttpResponse.json({ items: reminders, total: reminders.length })
    ),
    http.get('/api/v1/notifications/recently-deleted', () =>
      HttpResponse.json({ items: deleted, total: deleted.length })
    ),
    http.patch('/api/v1/notifications/:id/read', () => HttpResponse.json({ ...mention, is_read: true })),
    http.delete('/api/v1/notifications/:id/permanent', ({ params }) => {
      calls.purgedNotif.push(String(params.id))
      return new HttpResponse(null, { status: 204 })
    }),
    http.delete('/api/v1/notifications/:id', ({ params }) => {
      calls.dismissed.push(String(params.id))
      return new HttpResponse(null, { status: 204 })
    }),
    http.post('/api/v1/notifications/:id/restore', ({ params }) => {
      calls.restoredNotif.push(String(params.id))
      return HttpResponse.json(mention)
    }),
    http.post('/api/v1/notes/:id/restore', ({ params }) => {
      calls.restoredNote.push(String(params.id))
      return HttpResponse.json({ id: params.id })
    }),
    http.delete('/api/v1/notes/:id/permanent', ({ params }) => {
      calls.purgedNote.push(String(params.id))
      return new HttpResponse(null, { status: 204 })
    }),
    http.delete('/api/v1/notes/:id', () => new HttpResponse(null, { status: 204 }))
  )
  return calls
}

function LocationProbe({ calls }: { calls: Calls }) {
  const location = useLocation()
  if (location.pathname !== '/notifications') calls.navigatedAway = true
  return <span data-testid="location">{location.pathname}</span>
}

function renderPage(calls: Calls) {
  return render(
    <QueryClientProvider client={makeClient()}>
      <MemoryRouter initialEntries={['/notifications']}>
        <Routes>
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/repos/:id" element={<div>Repo page</div>} />
        </Routes>
        <LocationProbe calls={calls} />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

beforeEach(() => localStorage.clear())

// ──────────────────────────────────────────────
// Dismissing a mention you are done with
// ──────────────────────────────────────────────
describe('Notification rows — remove control', () => {
  it('offers a remove button alongside the row', async () => {
    const calls = setup()
    renderPage(calls)

    await screen.findByText('You were mentioned')
    expect(screen.getByTitle('Remove notification')).toBeInTheDocument()
  })

  it('dismisses the notification without navigating away', async () => {
    const calls = setup()
    renderPage(calls)

    await screen.findByText('You were mentioned')
    fireEvent.click(screen.getByTitle('Remove notification'))

    await waitFor(() => expect(calls.dismissed).toEqual(['n1']))
    // Clicking the row itself still opens the repo; the remove button must not
    expect(calls.navigatedAway).toBe(false)
  })

  it('still navigates when the row itself is clicked', async () => {
    const calls = setup()
    renderPage(calls)

    fireEvent.click(await screen.findByText('You were mentioned'))

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/repos/repo-1'))
    expect(calls.dismissed).toEqual([])
  })
})

// ──────────────────────────────────────────────
// The Recently deleted section
// ──────────────────────────────────────────────
describe('Recently deleted section', () => {
  it('stays hidden while nothing has been deleted', async () => {
    const calls = setup({ deleted: [] })
    renderPage(calls)

    await screen.findByText('You were mentioned')
    expect(screen.queryByTestId('recently-deleted')).not.toBeInTheDocument()
  })

  it('lists deleted notifications and reminders together', async () => {
    const calls = setup({ deleted: [deletedNotification, deletedReminder] })
    renderPage(calls)

    expect(await screen.findByTestId('recently-deleted')).toBeInTheDocument()
    expect(screen.getByText('Dismissed mention about the parser')).toBeInTheDocument()
    expect(screen.getByText('Chase missing submission')).toBeInTheDocument()
    expect(screen.getByText(/recently deleted/i)).toBeInTheDocument()
  })

  it('restores a deleted notification', async () => {
    const calls = setup({ deleted: [deletedNotification] })
    renderPage(calls)

    await screen.findByTestId('recently-deleted')
    fireEvent.click(screen.getByTitle('Restore Mention'))

    await waitFor(() => expect(calls.restoredNotif).toEqual(['n1']))
  })

  it('permanently deletes a notification', async () => {
    const calls = setup({ deleted: [deletedNotification] })
    renderPage(calls)

    await screen.findByTestId('recently-deleted')
    fireEvent.click(screen.getByTitle('Delete Mention forever'))

    await waitFor(() => expect(calls.purgedNotif).toEqual(['n1']))
  })

  it('restores a deleted reminder through the notes endpoint', async () => {
    const calls = setup({ deleted: [deletedReminder] })
    renderPage(calls)

    await screen.findByTestId('recently-deleted')
    fireEvent.click(screen.getByTitle('Restore Reminder'))

    await waitFor(() => expect(calls.restoredNote).toEqual(['rem-9']))
  })

  it('permanently deletes a reminder through the notes endpoint', async () => {
    const calls = setup({ deleted: [deletedReminder] })
    renderPage(calls)

    await screen.findByTestId('recently-deleted')
    fireEvent.click(screen.getByTitle('Delete Reminder forever'))

    await waitFor(() => expect(calls.purgedNote).toEqual(['rem-9']))
  })
})
