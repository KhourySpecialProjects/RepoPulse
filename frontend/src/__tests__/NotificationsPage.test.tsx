import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { NotificationsPage } from '@/pages/NotificationsPage'
import { AppSidebar } from '@/components/AppSidebar'
import { SidebarContext } from '@/contexts/SidebarContext'
import type { Notification, Reminder } from '@/types'

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
  id: 'n-mention',
  type: 'mention',
  note_id: 'note-1',
  comment_id: null,
  is_read: false,
  created_at: '2026-09-10T11:00:00Z',
  note_content_preview: 'Hey @Mark take a look',
  repo_id: 'repo-1',
}

const reminderNotif: Notification = {
  id: 'n-reminder',
  type: 'reminder',
  note_id: 'rem-1',
  comment_id: null,
  is_read: true,
  created_at: '2026-09-10T11:30:00Z',
  note_content_preview: 'Office hours',
  repo_id: null,
}

const commentNotif: Notification = {
  id: 'n-comment',
  type: 'note_comment',
  note_id: 'note-2',
  comment_id: 'c-1',
  is_read: true,
  created_at: '2026-09-10T10:00:00Z',
  note_content_preview: 'Replied to you',
  repo_id: 'repo-2',
}

const activeReminder: Reminder = {
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

function setup(opts?: {
  items?: Notification[]
  reminders?: Reminder[]
  onPatchRead?: (id: string) => void
  onMarkAll?: () => void
  onDelete?: (id: string) => void
  onCreate?: (body: unknown) => void
}) {
  const items = opts?.items ?? []
  const reminders = opts?.reminders ?? []
  server.use(
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
    http.patch('/api/v1/notifications/:id/read', ({ params }) => {
      opts?.onPatchRead?.(String(params.id))
      return HttpResponse.json({ ...mention, id: String(params.id), is_read: true })
    }),
    http.post('/api/v1/notifications/mark-all-read', () => {
      opts?.onMarkAll?.()
      return HttpResponse.json({ marked_read: items.length })
    }),
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

function LocationDisplay() {
  const location = useLocation()
  return <span data-testid="location">{location.pathname}</span>
}

function renderPage() {
  return render(
    <QueryClientProvider client={makeClient()}>
      <MemoryRouter initialEntries={['/notifications']}>
        <Routes>
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/repos/:id" element={<div>Repo page</div>} />
        </Routes>
        <LocationDisplay />
      </MemoryRouter>
    </QueryClientProvider>
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
          <LocationDisplay />
        </SidebarContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

const currentPath = () => screen.getByTestId('location').textContent

beforeEach(() => localStorage.clear())

// ──────────────────────────────────────────────
// 1. It is a real page, not a popup
// ──────────────────────────────────────────────
describe('NotificationsPage — is a full page', () => {
  it('renders a page with its own header', async () => {
    setup()
    renderPage()

    expect(await screen.findByTestId('notifications-page')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Notifications' })).toBeInTheDocument()
  })

  it('does not render a floating dropdown or backdrop', async () => {
    setup({ items: [mention] })
    renderPage()

    await screen.findByTestId('notifications-page')
    expect(screen.queryByTestId('notification-dropdown')).not.toBeInTheDocument()
    expect(screen.queryByTestId('notification-backdrop')).not.toBeInTheDocument()
  })
})

// ──────────────────────────────────────────────
// 2. The sidebar bell navigates instead of popping up
// ──────────────────────────────────────────────
describe('Sidebar notifications button — navigates to the page', () => {
  it('routes to /notifications when clicked', async () => {
    setup({ items: [mention] })
    renderSidebar()

    fireEvent.click(await screen.findByRole('button', { name: /notifications/i }))

    expect(currentPath()).toBe('/notifications')
  })

  it('opens no popup when clicked', async () => {
    setup({ items: [mention] })
    renderSidebar()

    fireEvent.click(await screen.findByRole('button', { name: /notifications/i }))

    await waitFor(() =>
      expect(screen.queryByTestId('notification-dropdown')).not.toBeInTheDocument()
    )
    expect(screen.queryByTestId('notification-backdrop')).not.toBeInTheDocument()
  })

  it('still shows the unread count badge', async () => {
    setup({ items: [mention] })
    renderSidebar()

    expect(await screen.findByTestId('unread-badge')).toHaveTextContent('1')
  })
})

// ──────────────────────────────────────────────
// 3. Notification list
// ──────────────────────────────────────────────
describe('NotificationsPage — notification list', () => {
  it('labels each notification type', async () => {
    setup({ items: [mention, reminderNotif, commentNotif] })
    renderPage()

    expect(await screen.findByText('You were mentioned')).toBeInTheDocument()
    expect(screen.getByText('Reminder due')).toBeInTheDocument()
    expect(screen.getByText('New comment on your note')).toBeInTheDocument()
  })

  it('shows an empty state when there is nothing', async () => {
    setup({ items: [] })
    renderPage()

    expect(await screen.findByText('No notifications')).toBeInTheDocument()
  })

  it('marks a notification read and navigates to its repo', async () => {
    const onPatchRead = vi.fn()
    setup({ items: [mention], onPatchRead })
    renderPage()

    fireEvent.click(await screen.findByText('You were mentioned'))

    await waitFor(() => expect(onPatchRead).toHaveBeenCalledWith('n-mention'))
    await waitFor(() => expect(currentPath()).toBe('/repos/repo-1'))
  })

  it('marks everything read from the page header', async () => {
    const onMarkAll = vi.fn()
    setup({ items: [mention], onMarkAll })
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: /mark all read/i }))

    await waitFor(() => expect(onMarkAll).toHaveBeenCalled())
  })

  it('reports the unread total in the header', async () => {
    setup({ items: [mention, reminderNotif] })
    renderPage()

    expect(await screen.findByText(/1 unread/i)).toBeInTheDocument()
  })
})

// ──────────────────────────────────────────────
// 4. Active reminders live on the page too
// ──────────────────────────────────────────────
describe('NotificationsPage — active reminders', () => {
  it('lists active reminders with a countdown', async () => {
    setup({ reminders: [activeReminder] })
    renderPage()

    expect(await screen.findByText('Review Bob PR')).toBeInTheDocument()
    expect(screen.getByText(/in \d+d/)).toBeInTheDocument()
  })

  it('shows an empty state with no active reminders', async () => {
    setup({ reminders: [] })
    renderPage()

    expect(await screen.findByText(/no active reminders/i)).toBeInTheDocument()
  })

  it('removes a reminder', async () => {
    const onDelete = vi.fn()
    setup({ reminders: [activeReminder], onDelete })
    renderPage()

    await screen.findByText('Review Bob PR')
    fireEvent.click(screen.getByTitle('Remove reminder'))

    await waitFor(() => expect(onDelete).toHaveBeenCalledWith('rem-1'))
  })

  it('creates a reminder with a due date', async () => {
    const onCreate = vi.fn()
    setup({ reminders: [], onCreate })
    renderPage()

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
})
