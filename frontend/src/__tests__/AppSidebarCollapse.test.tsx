import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useState } from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AppSidebar } from '@/components/AppSidebar'
import { App } from '@/App'
import { SidebarContext, COLLAPSED_GUTTER } from '@/contexts/SidebarContext'

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'user-instructor-1', display_name: 'Instructor Mark', role: 'instructor' as const },
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

/** Harness with real collapse state so the toggle actually round-trips. */
function Harness() {
  const [collapsed, setCollapsed] = useState(false)
  const [width, setWidth] = useState(220)
  return (
    <SidebarContext.Provider value={{ collapsed, setCollapsed, width, setWidth }}>
      <AppSidebar />
    </SidebarContext.Provider>
  )
}

function renderSidebar() {
  return render(
    <QueryClientProvider client={makeClient()}>
      <MemoryRouter initialEntries={['/collections']}>
        <Harness />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

function renderApp() {
  return render(
    <QueryClientProvider client={makeClient()}>
      <MemoryRouter initialEntries={['/collections']}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

const collapseBtn = () => screen.getByTitle('Collapse sidebar')
const expandBtn = () => screen.getByTitle('Expand sidebar')
const panel = (c: HTMLElement) =>
  c.querySelector('.fixed.left-0.top-0.bottom-0') as HTMLElement | null

beforeEach(() => {
  localStorage.clear()
})

describe('AppSidebar collapse — hides the sidebar', () => {
  it('hides all sidebar content when collapsed, leaving only the expand arrow', async () => {
    renderSidebar()
    await waitFor(() => expect(screen.getByText('CS 101 Fall 2025')).toBeInTheDocument())

    fireEvent.click(collapseBtn())

    expect(expandBtn()).toBeInTheDocument()
    expect(screen.queryByText('RepoPulse')).not.toBeInTheDocument()
    expect(screen.queryByText('CS 101 Fall 2025')).not.toBeInTheDocument()
    expect(screen.queryByText('Settings')).not.toBeInTheDocument()
    expect(screen.queryByText('Log out')).not.toBeInTheDocument()
    expect(screen.queryByTitle('Drag to resize')).not.toBeInTheDocument()
  })

  it('keeps the expand arrow on the same horizontal line as the collapse arrow', async () => {
    renderSidebar()
    await waitFor(() => expect(screen.getByText('CS 101 Fall 2025')).toBeInTheDocument())

    // Collapse arrow sits inside the 56px-tall (h-14) header row
    expect(collapseBtn().closest('.h-14')).not.toBeNull()

    fireEvent.click(collapseBtn())

    // Expand arrow is pinned to that same header band, not pushed below the bell
    expect(expandBtn().className).toMatch(/\bfixed\b/)
    expect(expandBtn().className).toMatch(/\btop-3\b/)
  })

  it('restores the full sidebar when the expand arrow is clicked', async () => {
    renderSidebar()
    await waitFor(() => expect(screen.getByText('CS 101 Fall 2025')).toBeInTheDocument())

    fireEvent.click(collapseBtn())
    expect(screen.queryByText('RepoPulse')).not.toBeInTheDocument()

    fireEvent.click(expandBtn())

    await waitFor(() => expect(screen.getByText('RepoPulse')).toBeInTheDocument())
    expect(screen.getByText('Settings')).toBeInTheDocument()
    expect(screen.getByTitle('Collapse sidebar')).toBeInTheDocument()
    expect(screen.queryByTitle('Expand sidebar')).not.toBeInTheDocument()
  })
})

describe('AppSidebar collapse — closes off page content', () => {
  it('leaves a slim rail exactly as wide as the reserved gutter', async () => {
    const { container } = renderSidebar()
    await waitFor(() => expect(screen.getByText('CS 101 Fall 2025')).toBeInTheDocument())

    expect(panel(container)!.style.width).toBe('220px')

    fireEvent.click(collapseBtn())

    // Rail lines up exactly with the gutter main reserves, so the page header
    // butts against it instead of stopping short with a raw, open edge
    expect(panel(container)!.style.width).toBe(`${COLLAPSED_GUTTER}px`)
  })

  it('gives the rail a right border so the header edge reads as closed', async () => {
    const { container } = renderSidebar()
    await waitFor(() => expect(screen.getByText('CS 101 Fall 2025')).toBeInTheDocument())

    fireEvent.click(collapseBtn())

    expect(panel(container)!.className).toMatch(/border-r/)
  })

  it('reserves a gutter wide enough to clear the arrow', () => {
    // Arrow is left-3 (12px) and w-8 (32px), so it ends at 44px. The gutter
    // must exceed that or page content slides underneath it.
    expect(COLLAPSED_GUTTER).toBeGreaterThan(44)
  })

  it('offsets main content by the gutter when collapsed, not by zero', () => {
    localStorage.setItem('sidebar_collapsed', 'true')
    const { container } = renderApp()

    const main = container.querySelector('main') as HTMLElement
    expect(main).not.toBeNull()
    expect(main.style.marginLeft).toBe(`${COLLAPSED_GUTTER}px`)
  })

  it('offsets main content by the full sidebar width when expanded', () => {
    localStorage.setItem('sidebar_collapsed', 'false')
    localStorage.setItem('sidebar_width', '220')
    const { container } = renderApp()

    const main = container.querySelector('main') as HTMLElement
    expect(main.style.marginLeft).toBe('220px')
  })
})

describe('AppSidebar collapse — expand arrow matches the app theme', () => {
  it('renders the expand arrow in the indigo theme colour', async () => {
    renderSidebar()
    await waitFor(() => expect(screen.getByText('CS 101 Fall 2025')).toBeInTheDocument())

    fireEvent.click(collapseBtn())

    // Indigo matches the active nav item, commit links and course tags
    const cls = expandBtn().className
    expect(cls).toMatch(/bg-indigo-600/)
    expect(cls).toMatch(/text-white/)
    expect(cls).toMatch(/hover:bg-indigo-700/)
  })

  it('renders the expand arrow as its own raised box', async () => {
    renderSidebar()
    await waitFor(() => expect(screen.getByText('CS 101 Fall 2025')).toBeInTheDocument())

    fireEvent.click(collapseBtn())

    const cls = expandBtn().className
    expect(cls).toMatch(/rounded/)
    expect(cls).toMatch(/shadow/)
  })
})
