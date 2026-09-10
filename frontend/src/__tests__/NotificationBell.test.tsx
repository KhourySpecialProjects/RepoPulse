import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { AppSidebar } from '@/components/AppSidebar'
import { SidebarContext } from '@/contexts/SidebarContext'
import type { Notification } from '@/types'

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
  created_at: '2026-09-10T11:00:00Z',
  note_content_preview: 'Hey @Mark',
  repo_id: 'repo-1',
})

function setup(opts?: {
  unread?: number
  items?: Notification[]
  onPatchRead?: (id: string) => void
  onMarkAll?: () => void
}) {
  const items = opts?.items ?? []
  server.use(
    http.get('/api/v1/notifications', () =>
      HttpResponse.json({
        items,
        total: items.length,
        unread_count: opts?.unread ?? items.filter((n) => !n.is_read).length,
      })
    ),
    http.get('/api/v1/notifications/unread-count', () =>
      HttpResponse.json({
        unread_count: opts?.unread ?? items.filter((n) => !n.is_read).length,
      })
    ),
    http.get('/api/v1/notifications/reminders', () =>
      HttpResponse.json({ items: [], total: 0 })
    ),
    // The backend defines PATCH for marking a single notification read
    http.patch('/api/v1/notifications/:id/read', ({ params }) => {
      opts?.onPatchRead?.(String(params.id))
      return HttpResponse.json({ ...notif(String(params.id), true) })
    }),
    // ...and POST /mark-all-read for the bulk action
    http.post('/api/v1/notifications/mark-all-read', () => {
      opts?.onMarkAll?.()
      return HttpResponse.json({ marked_read: items.length })
    })
  )
}

function renderSidebar(width = 220) {
  return render(
    <QueryClientProvider client={makeClient()}>
      <MemoryRouter initialEntries={['/collections']}>
        <SidebarContext.Provider
          value={{ collapsed: false, setCollapsed: () => {}, width, setWidth: () => {} }}
        >
          <AppSidebar />
        </SidebarContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

const bell = () => screen.getByRole('button', { name: /notifications/i })

beforeEach(() => localStorage.clear())

// ──────────────────────────────────────────────
// 1. Unread count badge
// ──────────────────────────────────────────────
describe('Notifications button — unread count badge', () => {
  it('shows the number of unread notifications', async () => {
    setup({ unread: 4 })
    renderSidebar()

    const badge = await screen.findByTestId('unread-badge')
    expect(badge).toHaveTextContent('4')
  })

  it('shows no badge when everything is read', async () => {
    setup({ unread: 0 })
    renderSidebar()

    await waitFor(() => expect(bell()).toBeInTheDocument())
    expect(screen.queryByTestId('unread-badge')).not.toBeInTheDocument()
  })

  it('caps the badge at 99+', async () => {
    setup({ unread: 512 })
    renderSidebar()

    expect(await screen.findByTestId('unread-badge')).toHaveTextContent('99+')
  })

  it('exposes the count to screen readers on the button itself', async () => {
    setup({ unread: 3 })
    renderSidebar()

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /3 unread/i })).toBeInTheDocument()
    )
  })
})

// ──────────────────────────────────────────────
// 2. Dropdown must escape the sidebar's overflow-hidden
// ──────────────────────────────────────────────
describe('Notifications dropdown — not clipped by the sidebar', () => {
  it('renders the dropdown outside the sidebar panel', async () => {
    setup({ items: [notif('n1')] })
    const { container } = renderSidebar()

    fireEvent.click(bell())

    const panel = await screen.findByTestId('notification-dropdown')
    // The sidebar root is overflow-hidden, so anything rendered inside it and
    // positioned beyond its width is clipped away and invisible.
    const sidebarRoot = container.querySelector('.fixed.left-0.top-0.bottom-0')
    expect(sidebarRoot).not.toBeNull()
    expect(sidebarRoot!.contains(panel)).toBe(false)
  })

  it('stacks the dropdown above its click-catching backdrop', async () => {
    setup({ items: [notif('n1')] })
    renderSidebar()

    fireEvent.click(bell())

    const panel = await screen.findByTestId('notification-dropdown')
    const backdrop = screen.getByTestId('notification-backdrop')
    const zOf = (el: HTMLElement) => Number(getComputedStyle(el).zIndex)
    expect(zOf(panel)).toBeGreaterThan(zOf(backdrop))
  })

  it('closes when the backdrop is clicked', async () => {
    setup({ items: [notif('n1')] })
    renderSidebar()

    fireEvent.click(bell())
    await screen.findByTestId('notification-dropdown')

    fireEvent.click(screen.getByTestId('notification-backdrop'))

    await waitFor(() =>
      expect(screen.queryByTestId('notification-dropdown')).not.toBeInTheDocument()
    )
  })
})

// ──────────────────────────────────────────────
// 3. Marking read must reach the real endpoints
// ──────────────────────────────────────────────
describe('Notifications — marking read', () => {
  it('marks a single notification read via PATCH', async () => {
    const onPatchRead = vi.fn()
    setup({ items: [notif('n1')], onPatchRead })
    renderSidebar()

    fireEvent.click(bell())
    fireEvent.click(await screen.findByText('You were mentioned'))

    await waitFor(() => expect(onPatchRead).toHaveBeenCalledWith('n1'))
  })

  it('marks everything read via the mark-all-read endpoint', async () => {
    const onMarkAll = vi.fn()
    setup({ items: [notif('n1')], onMarkAll })
    renderSidebar()

    fireEvent.click(bell())
    fireEvent.click(await screen.findByText('Mark all read'))

    await waitFor(() => expect(onMarkAll).toHaveBeenCalled())
  })
})
