import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CollectionDetailPage } from '@/pages/CollectionDetailPage'

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

function renderDetail() {
  return render(
    <QueryClientProvider client={makeClient()}>
      <MemoryRouter initialEntries={['/collections/col-1']}>
        <Routes>
          <Route path="/collections/:id" element={<CollectionDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

const header = (c: HTMLElement) =>
  c.querySelector('[data-testid="page-header"]') as HTMLElement
const panel = () => screen.queryByTestId('access-panel')
const manageBtn = () => screen.getByTitle('Manage access')

async function renderOpened() {
  const view = renderDetail()
  await waitFor(() => expect(header(view.container)).not.toBeNull())
  fireEvent.click(manageBtn())
  await waitFor(() => expect(panel()).not.toBeNull())
  return view
}

beforeEach(() => localStorage.clear())

describe('Manage access — disclosure behaviour', () => {
  it('stays closed until the button is pressed', async () => {
    const { container } = renderDetail()
    await waitFor(() => expect(header(container)).not.toBeNull())

    expect(panel()).toBeNull()
  })

  it('opens when the button is pressed and closes again on a second press', async () => {
    await renderOpened()

    fireEvent.click(manageBtn())
    await waitFor(() => expect(panel()).toBeNull())
  })

  it('reports its expanded state to assistive tech', async () => {
    const { container } = renderDetail()
    await waitFor(() => expect(header(container)).not.toBeNull())
    expect(manageBtn()).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(manageBtn())

    await waitFor(() => expect(manageBtn()).toHaveAttribute('aria-expanded', 'true'))
  })
})

describe('Manage access — opens under the whole title box', () => {
  it('renders the panel outside the title box, not squeezed inside it', async () => {
    const { container } = await renderOpened()

    // Nested inside the header it becomes a flex item beside the title, which
    // is what made it feel cramped. It belongs below the whole bar.
    expect(header(container).contains(panel())).toBe(false)
  })

  it('places the panel immediately after the title box', async () => {
    const { container } = await renderOpened()

    expect(header(container).nextElementSibling).toBe(panel())
  })

  it('spans the full page width with its own separating edge', async () => {
    await renderOpened()

    const cls = panel()!.className
    expect(cls).toMatch(/border-b/)
    // No max-width or inline sizing that would keep it button-width
    expect(cls).not.toMatch(/max-w-/)
    expect(cls).not.toMatch(/absolute|fixed/)
  })
})

describe('Manage access — the title box keeps its own layout', () => {
  it('keeps the title and repository count stacked inside the bar', async () => {
    const { container } = renderDetail()
    await waitFor(() => expect(header(container)).not.toBeNull())

    const heading = await screen.findByRole('heading', { level: 1 })
    const count = screen.getByText(/repositor/i)

    // Both belong to the title box; the count sits under the title, and the
    // header's flex row must not scatter them side by side.
    expect(header(container).contains(heading)).toBe(true)
    expect(header(container).contains(count)).toBe(true)
  })

  it('does not let the open panel change the title box contents', async () => {
    const { container } = await renderOpened()

    const heading = screen.getByRole('heading', { level: 1 })
    expect(header(container).contains(heading)).toBe(true)
    expect(screen.getByText(/repositor/i)).toBeInTheDocument()
  })
})
