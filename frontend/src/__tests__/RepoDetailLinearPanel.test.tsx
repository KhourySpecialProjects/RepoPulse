/**
 * The Linear panel sits beside the Commits card on Repo Detail: the two share
 * one row, Commits first, so each takes half the width on wide screens.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { RepoDetailPage } from '@/pages/RepoDetailPage'

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: vi.fn() }
})

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'user-test-1', display_name: 'Test User', role: 'instructor' as const },
    isAuthenticated: true,
    isLoading: false,
    login: () => Promise.resolve(),
    logout: () => {},
  }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}))

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/repos/repo-1']}>
        <Routes>
          <Route path="/repos/:id" element={<RepoDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('RepoDetailPage Linear panel', () => {
  it('renders the Linear panel in the same row as Commits, after it', async () => {
    server.use(
      http.get('/api/v1/repos/:id/linear', () =>
        HttpResponse.json({
          status: 'no_team',
          team: null,
          matched_by: null,
          stats: null,
          can_change_team: false,
        })
      )
    )
    renderPage()

    const row = await screen.findByTestId('commits-linear-row')
    const panel = await within(row).findByTestId('linear-panel')
    expect(within(panel).getByText('Linear info soon')).toBeInTheDocument()

    const commitsTitle = within(row).getByText('Commits')
    // Commits comes first in the DOM, so it is the left half.
    expect(
      commitsTitle.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })
})
