import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { NotificationsPage } from '@/pages/NotificationsPage'
import type { Notification, Reminder } from '@/types'

/**
 * These assertions pin the page's sizing intent: the notifications page was
 * ported out of a 320px popover, and its sections kept popover-scale padding
 * and type that left most of the page empty.
 */

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
  note_content_preview: 'Hey @Mark take a look at this commit',
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

function setup(items: Notification[] = [mention], reminders: Reminder[] = [reminder]) {
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

describe('Notifications page — sections fill the page', () => {
  it('does not squeeze the body into a narrow column', async () => {
    setup()
    renderPage()

    const body = await screen.findByTestId('notifications-body')
    // max-w-3xl left most of a normal window empty
    expect(body.className).not.toMatch(/max-w-(sm|md|lg|xl|2xl|3xl)\b/)
  })

  it('lets the reminders list grow instead of scrolling inside a short box', async () => {
    setup()
    renderPage()

    const list = await screen.findByTestId('reminders-list')
    expect(list.className).not.toMatch(/max-h-40\b/)
  })
})

describe('Notifications page — rows are comfortably sized', () => {
  it('gives reminder rows room to breathe', async () => {
    setup()
    renderPage()

    const row = await screen.findByTestId('reminder-row')
    expect(row.className).toMatch(/py-4\b/)
    expect(row.className).toMatch(/px-5\b/)
  })

  it('gives notification rows room to breathe', async () => {
    setup()
    renderPage()

    const row = await screen.findByTestId('notification-row')
    expect(row.className).toMatch(/py-4\b/)
    expect(row.className).toMatch(/px-5\b/)
  })

  it('drops the sub-11px type used in the popover', async () => {
    setup()
    renderPage()

    await screen.findByTestId('reminder-row')
    const tiny = document.querySelectorAll('[class*="text-[10px]"], [class*="text-[11px]"]')
    expect(tiny).toHaveLength(0)
  })
})

describe('Notifications page — still behaves the same', () => {
  it('keeps rendering both sections and their contents', async () => {
    setup()
    renderPage()

    await waitFor(() => expect(screen.getByText('Review Bob PR')).toBeInTheDocument())
    expect(screen.getByText('You were mentioned')).toBeInTheDocument()
    expect(screen.getByText(/active reminders/i)).toBeInTheDocument()
    expect(screen.getByText(/recent activity/i)).toBeInTheDocument()
  })

  it('keeps a roomy empty state when nothing is pending', async () => {
    setup([], [])
    renderPage()

    const empty = await screen.findByTestId('notifications-empty')
    expect(empty.className).toMatch(/py-(16|20|24)\b/)
  })
})
