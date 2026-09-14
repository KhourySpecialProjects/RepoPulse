/**
 * The notifications page splits into "what happened" on the left and "where
 * it gets sent" on the right, and the feed has to render repo-scoped events
 * that carry their own text instead of a note preview.
 */
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NotificationsPage } from '@/pages/NotificationsPage'
import type { Notification, NotificationSettings } from '@/types'

const getNotifications = vi.fn()
const getNotificationSettings = vi.fn()

vi.mock('@/services/api', () => ({
  getNotifications: (...a: unknown[]) => getNotifications(...a),
  getNotificationSettings: (...a: unknown[]) => getNotificationSettings(...a),
  updateNotificationSettings: vi.fn().mockResolvedValue({}),
  sendTestEmail: vi.fn().mockResolvedValue({ detail: '', sent_to: '' }),
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
  deleteNote: vi.fn(),
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

const SETTINGS: NotificationSettings = {
  email_enabled: false,
  transport: 'smtp',
  from_email: null,
  from_name: null,
  smtp_host: null,
  smtp_port: null,
  smtp_username: null,
  smtp_encryption: 'starttls',
  smtp_password_set: false,
  resend_api_key_set: false,
  subscribed_events: {
    mention: true,
    note_comment: true,
    reminder: true,
    repo_added: true,
    repo_removed: true,
    repo_health_declined: true,
    pr_opened: true,
    pr_merged: true,
  },
  deliverable: false,
}

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
    subject: null,
    body: null,
    emailed_at: null,
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
  getNotificationSettings.mockResolvedValue(SETTINGS)
  getNotifications.mockResolvedValue({ items: [], total: 0, unread_count: 0 })
})

describe('notifications page layout', () => {
  it('puts the email relay panel alongside the existing sections', async () => {
    renderPage()

    // Both columns are present...
    expect(await screen.findByTestId('email-relay-panel')).toBeInTheDocument()
    expect(screen.getByText('Recent activity')).toBeInTheDocument()

    // ...and the body is a two-column grid at lg and above.
    const body = screen.getByTestId('notifications-body')
    expect(body.className).toContain('lg:grid')
    expect(body.className).toContain('lg:grid-cols-[minmax(0,1fr)_24rem]')
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

  it('marks a notification that also went out by email', async () => {
    getNotifications.mockResolvedValue({
      items: [
        notif({
          type: 'pr_merged',
          subject: 'team-4 #7 merged: Add login',
          emailed_at: '2026-09-14T11:05:00Z',
        }),
      ],
      total: 1,
      unread_count: 1,
    })
    renderPage()

    expect(await screen.findByText('emailed')).toBeInTheDocument()
  })

  it('does not mark notifications that were never emailed', async () => {
    getNotifications.mockResolvedValue({
      items: [notif({ type: 'pr_opened', subject: 'team-4 #8 opened: Refactor' })],
      total: 1,
      unread_count: 1,
    })
    renderPage()

    expect(await screen.findByText('team-4 #8 opened: Refactor')).toBeInTheDocument()
    expect(screen.queryByText('emailed')).not.toBeInTheDocument()
  })
})
