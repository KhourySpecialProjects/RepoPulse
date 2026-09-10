import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { NotificationsPage } from '@/pages/NotificationsPage'
import { InboxZeroEasterEgg } from '@/components/InboxZeroEasterEgg'
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

const aNotification: Notification = {
  id: 'n1',
  type: 'mention',
  note_id: 'note-1',
  comment_id: null,
  is_read: false,
  created_at: '2026-09-10T11:00:00Z',
  note_content_preview: 'Hey @Mark',
  repo_id: 'repo-1',
}

const aReminder: Reminder = {
  id: 'rem-1',
  content: 'Review Bob PR',
  remind_at: '2099-01-01T10:00:00Z',
  reminder_context: null,
  repo_id: 'repo-1',
  commit_hash: null,
  created_at: '2026-09-01T10:00:00Z',
}

function setup(items: Notification[], reminders: Reminder[]) {
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
    )
  )
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

describe('InboxZeroEasterEgg — when it appears', () => {
  it('appears when there are no notifications and no reminders', async () => {
    setup([], [])
    renderPage()

    expect(await screen.findByTestId('inbox-zero-easter-egg')).toBeInTheDocument()
  })

  it('replaces the plain empty-state text', async () => {
    setup([], [])
    renderPage()

    await screen.findByTestId('inbox-zero-easter-egg')
    expect(screen.queryByText('No notifications')).not.toBeInTheDocument()
  })

  it('stays hidden when there are notifications', async () => {
    setup([aNotification], [])
    renderPage()

    await screen.findByText('You were mentioned')
    expect(screen.queryByTestId('inbox-zero-easter-egg')).not.toBeInTheDocument()
  })

  it('stays hidden when a reminder is still outstanding', async () => {
    setup([], [aReminder])
    renderPage()

    await screen.findByText('Review Bob PR')
    await waitFor(() =>
      expect(screen.queryByTestId('inbox-zero-easter-egg')).not.toBeInTheDocument()
    )
    // The ordinary empty state still explains the quiet feed
    expect(screen.getByText('No notifications')).toBeInTheDocument()
  })
})

describe('InboxZeroEasterEgg — the animation itself', () => {
  it('describes itself for assistive tech instead of exposing decoration', () => {
    render(<InboxZeroEasterEgg />)

    expect(screen.getByRole('img', { name: /inbox zero/i })).toBeInTheDocument()
  })

  it('renders a rainbow trail made of multiple stripes', () => {
    const { container } = render(<InboxZeroEasterEgg />)

    const stripes = container.querySelectorAll('[data-testid="rainbow-stripe"]')
    expect(stripes.length).toBeGreaterThanOrEqual(6)
  })

  it('keeps the flyer and the trail on screen', () => {
    const { container } = render(<InboxZeroEasterEgg />)

    expect(container.querySelector('[data-testid="inbox-zero-flyer"]')).not.toBeNull()
  })
})
