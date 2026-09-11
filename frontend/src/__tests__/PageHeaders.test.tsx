import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PAGE_HEADER_CLASS, PAGE_BODY_CLASS } from '@/lib/layout'
import { CollectionsPage } from '@/pages/CollectionsPage'
import { CollectionDetailPage } from '@/pages/CollectionDetailPage'
import { NotificationsPage } from '@/pages/NotificationsPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { AdminPage } from '@/pages/AdminPage'
import { DashboardPage } from '@/pages/DashboardPage'

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'user-instructor-1', display_name: 'Mark', role: 'admin' as const },
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

function renderAt(ui: React.ReactNode, path = '/') {
  return render(
    <QueryClientProvider client={makeClient()}>
      <MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>
    </QueryClientProvider>
  )
}

/** Every page's title bar must be the same element with the same height. */
async function expectSharedTitleBar(container: HTMLElement) {
  const header = await waitFor(() => {
    const el = container.querySelector('[data-testid="page-header"]')
    if (!el) throw new Error('no page header found')
    return el as HTMLElement
  })

  for (const token of PAGE_HEADER_CLASS.split(' ')) {
    expect(header.className).toContain(token)
  }
  return header
}

beforeEach(() => localStorage.clear())

// ──────────────────────────────────────────────
// The shared contract
// ──────────────────────────────────────────────
describe('page chrome constants', () => {
  it('gives the title bar a minimum height so it reads as a title', () => {
    expect(PAGE_HEADER_CLASS).toMatch(/min-h-/)
  })

  it('keeps the bar visually separated from the body', () => {
    expect(PAGE_HEADER_CLASS).toContain('border-b')
    expect(PAGE_HEADER_CLASS).toContain('bg-white')
  })

  it('leaves more room above the body content than below it', () => {
    const top = Number(/pt-(\d+)/.exec(PAGE_BODY_CLASS)?.[1])
    const bottom = Number(/pb-(\d+)/.exec(PAGE_BODY_CLASS)?.[1])
    expect(top).toBeGreaterThan(bottom)
  })
})

// ──────────────────────────────────────────────
// Every page in the app shell
// ──────────────────────────────────────────────
describe('every page uses the shared title bar', () => {
  it('Collections', async () => {
    const { container } = renderAt(<CollectionsPage />, '/collections')
    await expectSharedTitleBar(container)
    expect(screen.getByRole('heading', { name: 'Collections' })).toBeInTheDocument()
  })

  it('Notifications', async () => {
    const { container } = renderAt(<NotificationsPage />, '/notifications')
    await expectSharedTitleBar(container)
    expect(screen.getByRole('heading', { name: 'Notifications' })).toBeInTheDocument()
  })

  it('Settings', async () => {
    const { container } = renderAt(<SettingsPage />, '/settings')
    await expectSharedTitleBar(container)
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()
  })

  it('Admin', async () => {
    const { container } = renderAt(<AdminPage />, '/admin')
    await expectSharedTitleBar(container)
    expect(screen.getByRole('heading', { name: /admin/i })).toBeInTheDocument()
  })

  it('Dashboard', async () => {
    const { container } = renderAt(<DashboardPage />, '/')
    await expectSharedTitleBar(container)
    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
  })

  it('Collection detail', async () => {
    const { container } = render(
      <QueryClientProvider client={makeClient()}>
        <MemoryRouter initialEntries={['/collections/col-1']}>
          <Routes>
            <Route path="/collections/:id" element={<CollectionDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    )
    await expectSharedTitleBar(container)
  })
})

// ──────────────────────────────────────────────
// Nothing collides with the taller bar
// ──────────────────────────────────────────────
describe('the taller title bar does not overlap page content', () => {
  it('keeps the body as a sibling after the bar, not underneath it', async () => {
    const { container } = renderAt(<NotificationsPage />, '/notifications')
    const header = await expectSharedTitleBar(container)

    // Body follows the bar in normal flow — nothing is absolutely or fixed
    // positioned over it, so a taller bar can only push content down.
    const body = header.nextElementSibling as HTMLElement
    expect(body).not.toBeNull()
    const position = getComputedStyle(body).position
    expect(['static', '']).toContain(position)
  })

  it('does not stack two title bars on one page', async () => {
    const { container } = renderAt(<CollectionsPage />, '/collections')
    await expectSharedTitleBar(container)

    expect(container.querySelectorAll('[data-testid="page-header"]')).toHaveLength(1)
  })
})
