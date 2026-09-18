import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { AuthProvider } from '@/hooks/useAuth'
import { AccountSetupPage } from '@/pages/AccountSetupPage'

const VERIFY = '/api/v1/auth/account-setup/verify'
const COMPLETE = '/api/v1/auth/account-setup/complete'

const INVALID_BODY = {
  detail: 'This setup link is invalid or has expired.',
  error_code: 'SETUP_TOKEN_INVALID',
}

function renderAt(route: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[route]}>
        <AuthProvider>
          <Routes>
            <Route path="/account-setup" element={<AccountSetupPage />} />
            <Route path="/" element={<div>Dashboard</div>} />
            <Route path="/login" element={<div>Login Page</div>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

function mockValidToken() {
  server.use(
    http.post(VERIFY, () =>
      HttpResponse.json({
        email: 'student@example.com',
        display_name: 'Sam Student',
        expires_at: '2026-12-31T00:00:00Z',
      })
    )
  )
}

function mockInvalidToken() {
  server.use(http.post(VERIFY, () => HttpResponse.json(INVALID_BODY, { status: 400 })))
}

beforeEach(() => {
  localStorage.clear()
})

describe('AccountSetupPage — verifying the link', () => {
  it('greets the person the link was issued for', async () => {
    mockValidToken()
    renderAt('/account-setup?token=good-token')

    expect(await screen.findByText(/Sam Student/)).toBeInTheDocument()
  })

  it('sends the token from the query string to the verify endpoint', async () => {
    let received: unknown = null
    server.use(
      http.post(VERIFY, async ({ request }) => {
        received = await request.json()
        return HttpResponse.json({
          email: 'student@example.com',
          display_name: 'Sam Student',
          expires_at: '2026-12-31T00:00:00Z',
        })
      })
    )
    renderAt('/account-setup?token=abc123')

    await waitFor(() => expect(received).toEqual({ token: 'abc123' }))
  })

  it('shows the password form once the link checks out', async () => {
    mockValidToken()
    renderAt('/account-setup?token=good-token')

    expect(await screen.findByLabelText('New Password')).toBeInTheDocument()
    expect(screen.getByLabelText('Confirm Password')).toBeInTheDocument()
  })

  it('explains that an invalid link cannot be used', async () => {
    mockInvalidToken()
    renderAt('/account-setup?token=stale-token')

    expect(
      await screen.findByText(/invalid or has expired/i)
    ).toBeInTheDocument()
    expect(screen.queryByLabelText('New Password')).not.toBeInTheDocument()
  })

  it('does not redirect to login when the link is rejected', async () => {
    // A 401 would trip the api client's global interceptor; the endpoint
    // answers 400 so the user stays here and reads the message.
    mockInvalidToken()
    renderAt('/account-setup?token=stale-token')

    await screen.findByText(/invalid or has expired/i)
    expect(screen.queryByText('Login Page')).not.toBeInTheDocument()
  })

  it('rejects a missing token without calling the API', async () => {
    let called = false
    server.use(
      http.post(VERIFY, () => {
        called = true
        return HttpResponse.json(INVALID_BODY, { status: 400 })
      })
    )
    renderAt('/account-setup')

    expect(await screen.findByText(/invalid or has expired/i)).toBeInTheDocument()
    expect(called).toBe(false)
  })
})

describe('AccountSetupPage — setting the password', () => {
  it('signs the user in and lands them on the dashboard', async () => {
    mockValidToken()
    server.use(
      http.post(COMPLETE, () =>
        HttpResponse.json({
          access_token: 'fresh-token',
          token_type: 'bearer',
          user_id: 'user-new-1',
          display_name: 'Sam Student',
          role: 'ta',
        })
      )
    )
    renderAt('/account-setup?token=good-token')

    await userEvent.type(await screen.findByLabelText('New Password'), 'chosen-password')
    await userEvent.type(screen.getByLabelText('Confirm Password'), 'chosen-password')
    await userEvent.click(screen.getByRole('button', { name: /set password/i }))

    expect(await screen.findByText('Dashboard')).toBeInTheDocument()
    expect(localStorage.getItem('auth_token')).toBe('fresh-token')
    expect(JSON.parse(localStorage.getItem('auth_user') ?? '{}')).toMatchObject({
      id: 'user-new-1',
      display_name: 'Sam Student',
      role: 'ta',
    })
  })

  it('posts the token alongside the chosen password', async () => {
    mockValidToken()
    let received: unknown = null
    server.use(
      http.post(COMPLETE, async ({ request }) => {
        received = await request.json()
        return HttpResponse.json({
          access_token: 'fresh-token',
          token_type: 'bearer',
          user_id: 'user-new-1',
          display_name: 'Sam Student',
          role: 'ta',
        })
      })
    )
    renderAt('/account-setup?token=good-token')

    await userEvent.type(await screen.findByLabelText('New Password'), 'chosen-password')
    await userEvent.type(screen.getByLabelText('Confirm Password'), 'chosen-password')
    await userEvent.click(screen.getByRole('button', { name: /set password/i }))

    await waitFor(() =>
      expect(received).toEqual({ token: 'good-token', new_password: 'chosen-password' })
    )
  })

  it('will not submit mismatched passwords', async () => {
    mockValidToken()
    let called = false
    server.use(
      http.post(COMPLETE, () => {
        called = true
        return HttpResponse.json({}, { status: 200 })
      })
    )
    renderAt('/account-setup?token=good-token')

    await userEvent.type(await screen.findByLabelText('New Password'), 'chosen-password')
    await userEvent.type(screen.getByLabelText('Confirm Password'), 'different-password')
    await userEvent.click(screen.getByRole('button', { name: /set password/i }))

    expect(await screen.findByText(/do not match/i)).toBeInTheDocument()
    expect(called).toBe(false)
  })

  it('surfaces a link that expired between loading and submitting', async () => {
    mockValidToken()
    server.use(http.post(COMPLETE, () => HttpResponse.json(INVALID_BODY, { status: 400 })))
    renderAt('/account-setup?token=good-token')

    await userEvent.type(await screen.findByLabelText('New Password'), 'chosen-password')
    await userEvent.type(screen.getByLabelText('Confirm Password'), 'chosen-password')
    await userEvent.click(screen.getByRole('button', { name: /set password/i }))

    expect(await screen.findByText(/invalid or has expired/i)).toBeInTheDocument()
    expect(localStorage.getItem('auth_token')).toBeNull()
  })
})

describe('AccountSetupPage — the optional GitHub token', () => {
  function captureComplete(received: { body: unknown }) {
    server.use(
      http.post(COMPLETE, async ({ request }) => {
        received.body = await request.json()
        return HttpResponse.json({
          access_token: 'fresh-token',
          token_type: 'bearer',
          user_id: 'user-new-1',
          display_name: 'Sam Student',
          role: 'ta',
        })
      })
    )
  }

  it('offers a token field that is not required', async () => {
    mockValidToken()
    renderAt('/account-setup?token=good-token')

    const field = await screen.findByLabelText(/github token/i)
    expect(field).toBeInTheDocument()
    expect(field).not.toBeRequired()
  })

  it('sends the token the recipient typed', async () => {
    mockValidToken()
    const received: { body: unknown } = { body: null }
    captureComplete(received)
    renderAt('/account-setup?token=good-token')

    await userEvent.type(await screen.findByLabelText('New Password'), 'chosen-password')
    await userEvent.type(screen.getByLabelText('Confirm Password'), 'chosen-password')
    await userEvent.type(screen.getByLabelText(/github token/i), 'ghp_mine')
    await userEvent.click(screen.getByRole('button', { name: /set password/i }))

    await waitFor(() =>
      expect(received.body).toEqual({
        token: 'good-token',
        new_password: 'chosen-password',
        github_token: 'ghp_mine',
      })
    )
  })

  it('omits the field entirely when left blank', async () => {
    // An empty string would read as "clear my token" on a reset link.
    mockValidToken()
    const received: { body: unknown } = { body: null }
    captureComplete(received)
    renderAt('/account-setup?token=good-token')

    await userEvent.type(await screen.findByLabelText('New Password'), 'chosen-password')
    await userEvent.type(screen.getByLabelText('Confirm Password'), 'chosen-password')
    await userEvent.click(screen.getByRole('button', { name: /set password/i }))

    await waitFor(() => expect(received.body).not.toBeNull())
    expect(received.body).not.toHaveProperty('github_token')
  })

  it('still completes setup when no token is given', async () => {
    mockValidToken()
    captureComplete({ body: null })
    renderAt('/account-setup?token=good-token')

    await userEvent.type(await screen.findByLabelText('New Password'), 'chosen-password')
    await userEvent.type(screen.getByLabelText('Confirm Password'), 'chosen-password')
    await userEvent.click(screen.getByRole('button', { name: /set password/i }))

    expect(await screen.findByText('Dashboard')).toBeInTheDocument()
  })
})

describe('AccountSetupPage — already signed in', () => {
  it('warns that finishing setup will replace the current session', async () => {
    localStorage.setItem('auth_token', 'existing-token')
    localStorage.setItem(
      'auth_user',
      JSON.stringify({ id: 'user-admin-1', display_name: 'Admin User', role: 'admin' })
    )
    mockValidToken()
    renderAt('/account-setup?token=good-token')

    expect(await screen.findByText(/already signed in/i)).toBeInTheDocument()
    // Still usable — an admin checking their own link should not be blocked.
    expect(screen.getByLabelText('New Password')).toBeInTheDocument()
  })
})
