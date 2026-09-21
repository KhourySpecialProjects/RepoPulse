/**
 * The notifications page is a single column of "what happened", and the feed
 * has to render repo-scoped events that carry their own text instead of a note
 * preview.
 */
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NotificationsPage } from '@/pages/NotificationsPage'
import type { Notification } from '@/types'

const getNotifications = vi.fn()

vi.mock('@/services/api', () => ({
  // The reminders panel reads the signed-in user's subscriptions.
  getNotificationPreferences: () => Promise.resolve({ subscribed_events: {} }),
  updateNotificationPreferences: vi.fn(),
  getNotifications: (...a: unknown[]) => getNotifications(...a),
  getUnreadCount: () => Promise.resolve({ unread_count: 0 }),
  getReminders: () => Promise.resolve({ items: [], total: 0 }),
  getRecentlyDeleted: () => Promise.resolve({ items: [], total: 0 }),
  markNotificationRead: vi.fn(),
  markNotificationUnread: vi.fn(),
  markAllNotificationsRead: vi.fn(),
  markAllNotificationsUnread: vi.fn(),
  dismissNotification: vi.fn(),
  restoreNotification: vi.fn(),
  purgeNotification: vi.fn(),
  restoreNote: vi.fn(),
  purgeNote: vi.fn(),
  getUsers: () => Promise.resolve([]),
  createReminder: vi.fn(),
  createNote: vi.fn(),
  deleteNote: vi.fn(),
  getCurrentUser: () =>
    Promise.resolve({
      id: 'user-1',
      email: 'me@example.edu',
      display_name: 'Prof Owner',
      role: 'instructor',
    }),
  // Reminder rows prefetch their repo on hover.
  getRepo: vi.fn().mockResolvedValue({ id: 'repo-1', name: 'team-4' }),
  getRepoCommits: vi
    .fn()
    .mockResolvedValue({ items: [], total: 0, limit: 500, offset: 0 }),
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'user-1', display_name: 'Prof Owner', role: 'instructor' as const },
    isAuthenticated: true,
    isLoading: false,
    login: () => Promise.resolve(),
    devLogin: () => Promise.resolve(),
    logout: () => {},
  }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}))

function notif(over: Partial<Notification>): Notification {
  return {
    id: 'n1',
    type: 'mention',
    note_id: null,
    comment_id: null,
    is_read: false,
    created_at: '2026-09-14T11:00:00Z',
    note_content_preview: null,
    repo_id: null,
    commit_hash: null,
    subject: null,
    body: null,
    ...over,
  }
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <NotificationsPage />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  getNotifications.mockResolvedValue({ items: [], total: 0, unread_count: 0 })
})

describe('notifications page layout', () => {
  it('renders the feed full width, with no email relay panel', async () => {
    renderPage()

    expect(await screen.findByText('Recent activity')).toBeInTheDocument()
    expect(screen.queryByTestId('email-relay-panel')).not.toBeInTheDocument()

    // Single column: the old two-column grid is gone.
    const body = screen.getByTestId('notifications-body')
    expect(body.className).not.toContain('lg:grid')
  })

  it('renders a repo event using its own subject and body', async () => {
    getNotifications.mockResolvedValue({
      items: [
        notif({
          id: 'health-1',
          type: 'repo_health_declined',
          repo_id: 'repo-1',
          subject: 'team-4 health dropped to red',
          body: 'team-4 is now scoring red on its health signals (was yellow).',
        }),
      ],
      total: 1,
      unread_count: 1,
    })
    renderPage()

    expect(await screen.findByText('team-4 health dropped to red')).toBeInTheDocument()
    expect(
      screen.getByText('team-4 is now scoring red on its health signals (was yellow).')
    ).toBeInTheDocument()
  })

  it('falls back to a per-type title for note-scoped notifications', async () => {
    getNotifications.mockResolvedValue({
      items: [
        notif({
          type: 'mention',
          note_id: 'note-1',
          note_content_preview: 'Hey @Mark take a look',
        }),
      ],
      total: 1,
      unread_count: 1,
    })
    renderPage()

    expect(await screen.findByText('You were mentioned')).toBeInTheDocument()
    expect(screen.getByText('Hey @Mark take a look')).toBeInTheDocument()
  })
})
