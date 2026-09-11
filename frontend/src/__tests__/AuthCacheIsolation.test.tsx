import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { AuthProvider, useAuth } from '@/hooks/useAuth'

/**
 * Notifications, reminders and collections are all per-user. Cached responses
 * from one account must never be shown under another, so switching identity has
 * to drop the whole query cache.
 */

function seededClient() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  qc.setQueryData(['notifications', { limit: 50 }], {
    items: [{ id: 'leaked' }],
    total: 1,
    unread_count: 1,
  })
  qc.setQueryData(['notifications', 'reminders'], {
    items: [{ id: 'leaked-reminder' }],
    total: 1,
  })
  qc.setQueryData(['collections'], { items: [{ id: 'leaked-collection' }], total: 1 })
  return qc
}

function Harness() {
  const { devLogin, login, logout, user } = useAuth()
  return (
    <div>
      <span data-testid="who">{user?.display_name ?? 'nobody'}</span>
      <button onClick={() => void devLogin('user-ta-1')}>dev login</button>
      <button onClick={() => void login('ta@example.com', 'pw')}>login</button>
      <button onClick={() => logout()}>logout</button>
    </div>
  )
}

function renderWith(qc: QueryClient) {
  return render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <Harness />
      </AuthProvider>
    </QueryClientProvider>
  )
}

const cachedKeys = (qc: QueryClient) =>
  qc.getQueryCache().getAll().map((q) => JSON.stringify(q.queryKey))

beforeEach(() => {
  localStorage.clear()
  server.use(
    http.post('/api/v1/auth/dev-login', () =>
      HttpResponse.json({
        access_token: 'ta-token',
        token_type: 'bearer',
        user_id: 'user-ta-1',
        display_name: 'Teaching Assistant',
        role: 'ta',
      })
    ),
    http.post('/api/v1/auth/login', () =>
      HttpResponse.json({
        access_token: 'ta-token',
        token_type: 'bearer',
        user_id: 'user-ta-1',
        display_name: 'Teaching Assistant',
        role: 'ta',
      })
    )
  )
})

describe('Switching user drops cached per-user data', () => {
  it('clears the cache on dev login', async () => {
    const qc = seededClient()
    renderWith(qc)
    expect(cachedKeys(qc).length).toBeGreaterThan(0)

    fireEvent.click(screen.getByText('dev login'))

    await waitFor(() => expect(screen.getByTestId('who')).toHaveTextContent('Teaching Assistant'))
    expect(qc.getQueryData(['notifications', { limit: 50 }])).toBeUndefined()
    expect(qc.getQueryData(['notifications', 'reminders'])).toBeUndefined()
    expect(qc.getQueryData(['collections'])).toBeUndefined()
  })

  it('clears the cache on password login', async () => {
    const qc = seededClient()
    renderWith(qc)

    fireEvent.click(screen.getByText('login'))

    await waitFor(() => expect(screen.getByTestId('who')).toHaveTextContent('Teaching Assistant'))
    expect(qc.getQueryData(['notifications', { limit: 50 }])).toBeUndefined()
  })

  it('clears the cache on logout so the next user starts clean', async () => {
    const qc = seededClient()
    renderWith(qc)

    fireEvent.click(screen.getByText('logout'))

    await waitFor(() => expect(screen.getByTestId('who')).toHaveTextContent('nobody'))
    expect(qc.getQueryData(['notifications', { limit: 50 }])).toBeUndefined()
    expect(qc.getQueryData(['collections'])).toBeUndefined()
  })

  it('leaves no per-user query data behind at all', async () => {
    const qc = seededClient()
    renderWith(qc)

    fireEvent.click(screen.getByText('dev login'))

    await waitFor(() => expect(screen.getByTestId('who')).toHaveTextContent('Teaching Assistant'))
    expect(cachedKeys(qc)).toEqual([])
  })
})
