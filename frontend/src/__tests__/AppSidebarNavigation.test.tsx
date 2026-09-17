import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
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

/** Surfaces the current route so navigation can be asserted. */
function LocationDisplay() {
  const location = useLocation()
  return <span data-testid="location">{location.pathname}</span>
}

function Harness() {
  const [collapsed, setCollapsed] = useState(false)
  const [width, setWidth] = useState(220)
  const [dragging, setDragging] = useState(false)
  return (
    <SidebarContext.Provider
      value={{ collapsed, setCollapsed, width, setWidth, dragging, setDragging }}
    >
      <AppSidebar />
      <LocationDisplay />
    </SidebarContext.Provider>
  )
}

function renderSidebar(at = '/settings') {
  return render(
    <QueryClientProvider client={makeClient()}>
      <MemoryRouter initialEntries={[at]}>
        <Harness />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

const currentPath = () => screen.getByTestId('location').textContent

describe('AppSidebar — Collections heading navigates to the collections page', () => {
  it('routes to /collections when the Collections heading is clicked', async () => {
    renderSidebar()
    await waitFor(() => expect(screen.getByText('CS 101 Fall 2025')).toBeInTheDocument())
    expect(currentPath()).toBe('/settings')

    fireEvent.click(screen.getByRole('button', { name: 'Collections' }))

    expect(currentPath()).toBe('/collections')
  })

  it('exposes the Collections heading as a real control, not inert text', async () => {
    renderSidebar()
    await waitFor(() => expect(screen.getByText('CS 101 Fall 2025')).toBeInTheDocument())

    const heading = screen.getByRole('button', { name: 'Collections' })
    // Still reads as a section heading, and hints that it is clickable
    expect(heading.className).toMatch(/uppercase/)
    expect(heading.className).toMatch(/hover:/)
  })
})

describe('AppSidebar — RepoPulse logo navigates to the home page', () => {
  it('routes to / when the logo is clicked', async () => {
    renderSidebar()
    await waitFor(() => expect(screen.getByText('CS 101 Fall 2025')).toBeInTheDocument())
    expect(currentPath()).toBe('/settings')

    // The logo is a react-router <Link>, so it exposes role="link", not "button".
    fireEvent.click(screen.getByRole('link', { name: /RepoPulse/ }))

    expect(currentPath()).toBe('/')
  })
})

describe('AppSidebar — signing out', () => {
  it('leaves the visitor at the login form, not the public landing page', async () => {
    // Signing out only clears the session: whatever route it happened on
    // decides what comes next. At '/' that is the landing page, which exists
    // for people who have not signed in — not for someone who just signed out
    // and may well want straight back in.
    renderSidebar('/')
    await waitFor(() => expect(screen.getByText('CS 101 Fall 2025')).toBeInTheDocument())
    expect(currentPath()).toBe('/')

    fireEvent.click(screen.getByRole('button', { name: /Log out/ }))

    expect(currentPath()).toBe('/login')
  })
})
