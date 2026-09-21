import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RepoDetailPage } from '@/pages/RepoDetailPage'

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'user-test-1', display_name: 'Test User', role: 'instructor' as const },
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

function renderPage(repoId = 'repo-1') {
  return render(
    <QueryClientProvider client={makeClient()}>
      <MemoryRouter initialEntries={[`/repos/${repoId}`]}>
        <Routes>
          <Route path="/repos/:id" element={<RepoDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('RepoDetailPage — Remove action', () => {
  beforeEach(() => {
    mockNavigate.mockClear()
    vi.spyOn(window, 'confirm').mockReturnValue(false)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders a Remove button in the header', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('cs101-project')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /remove/i })).toBeInTheDocument()
  })

  it('shows a confirm dialog with the correct message when Remove is clicked', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderPage()
    await waitFor(() => expect(screen.getByText('cs101-project')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /remove/i }))
    expect(confirmSpy).toHaveBeenCalledWith('Remove this repository? This cannot be undone.')
  })

  it('does not navigate when confirm is cancelled', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderPage()
    await waitFor(() => expect(screen.getByText('cs101-project')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /remove/i }))
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  // 1aa10ce moved this off navigate(-1): going back could land the user on
  // the page of the repo they just deleted.
  it('navigates to the collection when delete succeeds', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderPage()
    await waitFor(() => expect(screen.getByText('cs101-project')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /remove/i }))
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/collections/col-1'))
  })
})
