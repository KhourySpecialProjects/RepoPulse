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

function Harness() {
  const [collapsed, setCollapsed] = useState(false)
  const [width, setWidth] = useState(220)
  const [dragging, setDragging] = useState(false)
  return (
    <SidebarContext.Provider
      value={{ collapsed, setCollapsed, width, setWidth, dragging, setDragging }}
    >
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

const panel = (c: HTMLElement) =>
  c.querySelector('.fixed.left-0.top-0.bottom-0') as HTMLElement
const mainEl = (c: HTMLElement) => c.querySelector('main') as HTMLElement
const collapseBtn = () => screen.getByTitle('Collapse sidebar')
const dragHandle = () => screen.getByTitle('Drag to resize')

beforeEach(() => localStorage.clear())

/**
 * jsdom runs no CSS, so none of this observes a frame of motion. What it can
 * hold is the two things the animation depends on: one DOM node that survives
 * the toggle (a swapped node has nothing to transition from), and the
 * transition being absent while the handle is being dragged.
 */
describe('AppSidebar open/close animation', () => {
  it('reuses the same element across the toggle so the width can animate', async () => {
    const { container } = renderSidebar()
    await waitFor(() => expect(screen.getByText('CS 101 Fall 2025')).toBeInTheDocument())

    const before = panel(container)
    expect(before.style.width).toBe('220px')

    fireEvent.click(collapseBtn())

    const after = panel(container)
    expect(after.style.width).toBe(`${COLLAPSED_GUTTER}px`)
    // The crux: React must reconcile onto the same node. Re-mounting a
    // different element would jump straight to the new width.
    expect(after).toBe(before)
  })

  it('transitions the panel width rather than snapping it', async () => {
    const { container } = renderSidebar()
    await waitFor(() => expect(screen.getByText('CS 101 Fall 2025')).toBeInTheDocument())

    expect(panel(container).className).toMatch(/transition-\[width/)
    expect(panel(container).className).toMatch(/duration-\d+/)
  })

  it('slides the page content in step with the panel', () => {
    const { container } = renderApp()

    expect(mainEl(container).className).toMatch(/transition-\[margin-left\]/)
    expect(mainEl(container).className).toMatch(/duration-\d+/)
  })

  // A transition during a drag makes the edge lag a frame behind the cursor,
  // which reads as the sidebar fighting you.
  it('drops the transition while the handle is being dragged', async () => {
    const { container } = renderApp()
    await waitFor(() => expect(screen.getByTitle('Drag to resize')).toBeInTheDocument())

    fireEvent.mouseDown(dragHandle())

    expect(panel(container).className).not.toMatch(/transition-\[width/)
    expect(mainEl(container).className).not.toMatch(/transition-\[margin-left\]/)
  })

  it('restores the transition once the drag ends', async () => {
    const { container } = renderApp()
    await waitFor(() => expect(screen.getByTitle('Drag to resize')).toBeInTheDocument())

    fireEvent.mouseDown(dragHandle())
    fireEvent.mouseUp(document)

    expect(panel(container).className).toMatch(/transition-\[width/)
    expect(mainEl(container).className).toMatch(/transition-\[margin-left\]/)
  })

  it('holds still for readers who ask for reduced motion', async () => {
    const { container } = renderApp()
    await waitFor(() => expect(screen.getByTitle('Drag to resize')).toBeInTheDocument())

    expect(panel(container).className).toMatch(/motion-reduce:transition-none/)
    expect(mainEl(container).className).toMatch(/motion-reduce:transition-none/)
  })
})
