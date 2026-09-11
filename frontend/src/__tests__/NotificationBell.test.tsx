import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
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

const notif = (id: string, isRead = false): Notification => ({
  id,
  type: 'mention',
  note_id: 'note-1',
  comment_id: null,
  is_read: isRead,
  created_at: '2026-09-11T11:00:00Z',
  note_content_preview: 'Hey @Mark',
  repo_id: 'repo-1',
})

const reminder = (id: string): Reminder => ({
  id,
  content: `Reminder ${id}`,
  remind_at: '2099-01-01T10:00:00Z',
  reminder_context: null,
  repo_id: 'repo-1',
  commit_hash: null,
  created_at: '2026-09-01T10:00:00Z',
})

function setup(opts?: {
  items?: Notification[]
  reminders?: Reminder[]
  /** Overrides the unread count, e.g. to simulate a large backlog. */
  unreadOverride?: number
}) {
  const items = opts?.items ?? []
  const reminders = opts?.reminders ?? []
  server.use(
    http.get('/api/v1/notifications', () =>
      HttpResponse.json({
        items,
        total: items.length,
        unread_count: opts?.unreadOverride ?? items.filter((n) => !n.is_read).length,
      })
    ),
    http.get('/api/v1/notifications/unread-count', () =>
      HttpResponse.json({
        unread_count: opts?.unreadOverride ?? items.filter((n) => !n.is_read).length,
      })
    ),
    http.get('/api/v1/notifications/reminders', () =>
      HttpResponse.json({ items: reminders, total: reminders.length })
    ),
    // Deleted items are filtered out server-side, so they can never reach the
    // badge; a populated bin must not change the count.
    http.get('/api/v1/notifications/recently-deleted', () =>
      HttpResponse.json({
        items: [
          {
            id: 'gone-1',
            kind: 'notification',
            label: 'Mention',
            detail: 'Dismissed',
            deleted_at: '2026-09-11T12:00:00Z',
          },
        ],
        total: 1,
      })
    )
  )
}

function LocationDisplay() {
  const location = useLocation()
  return <span data-testid="location">{location.pathname}</span>
}

function renderSidebar(width = 220) {
  return render(
    <QueryClientProvider client={makeClient()}>
      <MemoryRouter initialEntries={['/collections']}>
        <SidebarContext.Provider
          value={{ collapsed: false, setCollapsed: () => {}, width, setWidth: () => {} }}
        >
          <AppSidebar />
          <LocationDisplay />
        </SidebarContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

const bell = () => screen.getByRole('button', { name: /notifications/i })
const badge = () => screen.findByTestId('unread-badge')

beforeEach(() => localStorage.clear())

// ──────────────────────────────────────────────
// 1. What the badge counts
// ──────────────────────────────────────────────
describe('Notifications badge — counts everything on the page', () => {
  it('adds reminders and notifications together', async () => {
    setup({ items: [notif('n1'), notif('n2')], reminders: [reminder('r1')] })
    renderSidebar()

    expect(await badge()).toHaveTextContent('3')
  })

  it('stops counting a notification once it has been read', async () => {
    // Reading a notification must move the number, otherwise clicking one feels
    // like it did nothing and the only way to clear it is Mark all read.
    setup({ items: [notif('n1', true), notif('n2', false)], reminders: [] })
    renderSidebar()

    expect(await badge()).toHaveTextContent('1')
  })

  it('shows no badge when every notification is read and nothing is due', async () => {
    setup({ items: [notif('n1', true), notif('n2', true)], reminders: [] })
    renderSidebar()

    await waitFor(() => expect(bell()).toBeInTheDocument())
    expect(screen.queryByTestId('unread-badge')).not.toBeInTheDocument()
  })

  it('counts reminders on their own', async () => {
    setup({ items: [], reminders: [reminder('r1'), reminder('r2')] })
    renderSidebar()

    expect(await badge()).toHaveTextContent('2')
  })

  it('ignores anything sitting in Recently deleted', async () => {
    // The stubbed bin holds one item; the badge must stay at the live totals.
    setup({ items: [notif('n1')], reminders: [] })
    renderSidebar()

    expect(await badge()).toHaveTextContent('1')
  })

  it('shows no badge when the page would be empty', async () => {
    setup({ items: [], reminders: [] })
    renderSidebar()

    await waitFor(() => expect(bell()).toBeInTheDocument())
    expect(screen.queryByTestId('unread-badge')).not.toBeInTheDocument()
  })

  it('caps a large backlog at 99+', async () => {
    setup({ unreadOverride: 400, reminders: [reminder('r1')] })
    renderSidebar()

    expect(await badge()).toHaveTextContent('99+')
  })
})

// ──────────────────────────────────────────────
// 2. How it looks and reads
// ──────────────────────────────────────────────
describe('Notifications badge — appearance', () => {
  it('is a red circle', async () => {
    setup({ items: [notif('n1')], reminders: [] })
    renderSidebar()

    const el = await badge()
    expect(el.className).toMatch(/bg-red-/)
    expect(el.className).toMatch(/rounded-full/)
  })

  it('centres the number inside the circle', async () => {
    setup({ items: [notif('n1')], reminders: [] })
    renderSidebar()

    const el = await badge()
    expect(el.className).toMatch(/items-center/)
    expect(el.className).toMatch(/justify-center/)
    // Inherited line-height is what pushes a small digit off centre
    expect(el.className).toMatch(/leading-none/)
  })

  it('announces the count on the button', async () => {
    setup({ items: [notif('n1'), notif('n2')], reminders: [reminder('r1')] })
    renderSidebar()

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /3 pending/i })).toBeInTheDocument()
    )
  })
})

// ──────────────────────────────────────────────
// 3. Navigation is unchanged
// ──────────────────────────────────────────────
describe('Notifications button — navigation', () => {
  it('routes to the notifications page and opens no popup', async () => {
    setup({ items: [notif('n1')] })
    renderSidebar()

    fireEvent.click(bell())

    expect(screen.getByTestId('location')).toHaveTextContent('/notifications')
    expect(screen.queryByTestId('notification-dropdown')).not.toBeInTheDocument()
    expect(screen.queryByTestId('notification-backdrop')).not.toBeInTheDocument()
  })
})
