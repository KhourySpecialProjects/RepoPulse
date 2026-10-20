import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { SettingsPage } from '@/pages/SettingsPage'
import type { UserDetail } from '@/types'

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

const me: UserDetail = {
  id: 'user-instructor-1',
  email: 'mark@example.com',
  display_name: 'Mark',
  role: 'instructor',
  github_token_configured: true,
  linear_api_key_configured: false,
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

async function linearCard() {
  return (await screen.findByRole('heading', { name: 'Linear API Key' })).closest(
    '[data-testid="linear-key-card"]'
  ) as HTMLElement
}

describe('SettingsPage Linear API key', () => {
  it('reports when no key is configured', async () => {
    server.use(http.get('/api/v1/users/me', () => HttpResponse.json(me)))
    renderPage()

    const card = await linearCard()
    expect(await within(card).findByText('Not configured')).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: /save key/i })).toBeDisabled()
  })

  it('saves a new key', async () => {
    const user = userEvent.setup()
    let patched: unknown = null
    server.use(
      http.get('/api/v1/users/me', () => HttpResponse.json(me)),
      http.patch('/api/v1/users/me', async ({ request }) => {
        patched = await request.json()
        return HttpResponse.json({ ...me, linear_api_key_configured: true })
      })
    )
    renderPage()

    const card = await linearCard()
    await user.type(within(card).getByLabelText('Linear API key'), 'lin_api_abc')
    await user.click(within(card).getByRole('button', { name: /save key/i }))

    await waitFor(() => expect(patched).toEqual({ linear_api_key: 'lin_api_abc' }))
  })

  it('removes a configured key', async () => {
    const user = userEvent.setup()
    let patched: unknown = null
    server.use(
      http.get('/api/v1/users/me', () =>
        HttpResponse.json({ ...me, linear_api_key_configured: true })
      ),
      http.patch('/api/v1/users/me', async ({ request }) => {
        patched = await request.json()
        return HttpResponse.json(me)
      })
    )
    renderPage()

    const card = await linearCard()
    expect(await within(card).findByText('Key configured')).toBeInTheDocument()
    await user.click(within(card).getByRole('button', { name: /remove key/i }))

    await waitFor(() => expect(patched).toEqual({ linear_api_key: '' }))
  })
})
