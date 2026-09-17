import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { http, HttpResponse } from 'msw'
import { AuthProvider } from '@/hooks/useAuth'
import { LoginPage } from '@/pages/LoginPage'
import { server } from '@/mocks/server'

/**
 * Watch for a hard browser navigation. A full page load throws away React
 * state, so the login page would come back blank — no error message, empty
 * fields — which reads as the form resetting itself the instant you submit.
 */
function spyOnHardNavigation(): string[] {
  const navigations: string[] = []
  const original = window.location
  // A plain stand-in, not a wrapper around the jsdom Location: its accessors
  // reject a foreign receiver, which makes every relative request URL fail to
  // resolve and hides the behaviour under test.
  const { href, origin, protocol, host, hostname, port, pathname, search, hash } = original
  const stub = {
    origin, protocol, host, hostname, port, pathname, search, hash,
    get href() { return href },
    set href(value: string) { navigations.push(value) },
    assign: (value: string) => { navigations.push(value) },
    replace: (value: string) => { navigations.push(value) },
    reload: () => { navigations.push(href) },
    toString: () => href,
  }
  Object.defineProperty(window, 'location', { configurable: true, value: stub })
  restoreLocation = () => {
    Object.defineProperty(window, 'location', { configurable: true, value: original })
  }
  return navigations
}

let restoreLocation: (() => void) | null = null

beforeEach(() => localStorage.clear())
afterEach(() => {
  restoreLocation?.()
  restoreLocation = null
  vi.restoreAllMocks()
})

describe('Login with the wrong password', () => {
  it('keeps the error on screen instead of reloading the login page', async () => {
    const navigations = spyOnHardNavigation()
    server.use(http.post('*/api/v1/auth/login', () => HttpResponse.json(
      { detail: 'Invalid email or password', error_code: 'invalid_credentials' },
      { status: 401 }
    )))

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <AuthProvider>
          <MemoryRouter initialEntries={['/login']}>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/" element={<div>Signed in successfully</div>} />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </QueryClientProvider>
    )

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'teacher@example.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong-password' } })
    fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }))

    expect(await screen.findByText('Invalid email or password.')).toBeInTheDocument()
    expect(navigations).toEqual([])
    expect(screen.getByLabelText('Email')).toHaveValue('teacher@example.com')
    expect(screen.getByRole('button', { name: /^sign in$/i })).toBeEnabled()
    client.clear()
  })

  it('still signs an expired session out when a normal request 401s', async () => {
    const navigations = spyOnHardNavigation()
    localStorage.setItem('auth_token', 'stale-token')
    localStorage.setItem('auth_user', JSON.stringify({ id: 'u1', display_name: 'Mark', role: 'instructor' }))
    server.use(http.get('*/api/v1/collections', () => HttpResponse.json(
      { detail: 'Not authenticated', error_code: 'unauthorized' },
      { status: 401 }
    )))

    const { getCollections } = await import('@/services/api')
    await expect(getCollections()).rejects.toThrow()

    await waitFor(() => expect(navigations).toEqual(['/login']))
    expect(localStorage.getItem('auth_token')).toBeNull()
    expect(localStorage.getItem('auth_user')).toBeNull()
  })
})
