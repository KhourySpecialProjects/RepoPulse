import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AppSidebar } from '@/components/AppSidebar'
import { SidebarContext } from '@/contexts/SidebarContext'

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

const collapseBtn = () => screen.getByTitle('Collapse sidebar')
const expandBtn = () => screen.getByTitle('Expand sidebar')

describe('AppSidebar collapse — fully hides the sidebar', () => {
  it('hides all sidebar content when collapsed, leaving only the expand arrow', async () => {
    renderSidebar()
    await waitFor(() => expect(screen.getByText('CS 101 Fall 2025')).toBeInTheDocument())

    fireEvent.click(collapseBtn())

    // Only the reopen affordance survives
    expect(expandBtn()).toBeInTheDocument()

    // Everything else is gone — not merely narrowed into an icon rail
    expect(screen.queryByText('RepoPulse')).not.toBeInTheDocument()
    expect(screen.queryByText('CS 101 Fall 2025')).not.toBeInTheDocument()
    expect(screen.queryByText('Settings')).not.toBeInTheDocument()
    expect(screen.queryByText('Log out')).not.toBeInTheDocument()
    expect(screen.queryByTitle('Drag to resize')).not.toBeInTheDocument()
  })

  it('gives the sidebar zero width when collapsed so it occupies no space', async () => {
    const { container } = renderSidebar()
    await waitFor(() => expect(screen.getByText('CS 101 Fall 2025')).toBeInTheDocument())

    const panel = container.querySelector('.fixed.left-0.top-0.bottom-0') as HTMLElement
    expect(panel).not.toBeNull()
    expect(panel.style.width).toBe('220px')

    fireEvent.click(collapseBtn())

    const collapsedPanel = container.querySelector('.fixed.left-0.top-0.bottom-0') as HTMLElement | null
    // Either removed entirely, or rendered with no width
    if (collapsedPanel) {
      expect(collapsedPanel.style.width).toBe('0px')
    }
  })

  it('keeps the expand arrow on the same horizontal line as the collapse arrow', async () => {
    renderSidebar()
    await waitFor(() => expect(screen.getByText('CS 101 Fall 2025')).toBeInTheDocument())

    // Collapse arrow sits inside the 56px-tall (h-14) header row
    const header = collapseBtn().closest('.h-14')
    expect(header).not.toBeNull()

    fireEvent.click(collapseBtn())

    // Expand arrow is pinned to that same header band, not pushed below the bell
    const expand = expandBtn()
    expect(expand.className).toMatch(/\bfixed\b/)
    expect(expand.className).toMatch(/\btop-3\b/)
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
