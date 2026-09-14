import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
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
    devLogin: () => Promise.resolve(),
    logout: () => {},
  }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}))

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/repos/repo-1']}>
        <Routes>
          <Route path="/repos/:id" element={<RepoDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

const HEADERS = ['Commit', 'Author', 'Branch', '+/-']

describe('Commit table column headers', () => {
  it('labels every column', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('cs101-project')).toBeInTheDocument())

    for (const label of HEADERS) {
      expect(screen.getByRole('columnheader', { name: label })).toBeInTheDocument()
    }
  })

  it('keeps the headers outside the scrolling region', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('cs101-project')).toBeInTheDocument())

    // Headers inside the scroller either scroll out of view or, when made
    // sticky, paint over the first row. Keeping them out of it avoids both.
    const scrollRegion = screen.getByRole('region', { name: 'Commit list' })
    for (const label of HEADERS) {
      const header = screen.getByRole('columnheader', { name: label })
      expect(scrollRegion.contains(header)).toBe(false)
    }
  })

  it('gives the header the same column widths as the body', async () => {
    const { container } = renderPage()
    await waitFor(() => expect(screen.getByText('cs101-project')).toBeInTheDocument())

    // Misaligned colgroups would visibly stagger the headers over the data.
    const widthsPerTable = Array.from(container.querySelectorAll('table')).map(table =>
      Array.from(table.querySelectorAll('col')).map(col => col.className)
    )
    const tablesWithColumns = widthsPerTable.filter(widths => widths.length > 0)
    expect(tablesWithColumns.length).toBe(2)
    expect(tablesWithColumns[0]).toEqual(tablesWithColumns[1])
  })
})
