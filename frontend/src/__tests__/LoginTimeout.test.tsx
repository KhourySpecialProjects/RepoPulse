import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { delay, http, HttpResponse } from 'msw'
import { AuthProvider } from '@/hooks/useAuth'
import { LoginPage } from '@/pages/LoginPage'
import { server } from '@/mocks/server'

beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('Login when the backend stops responding', () => {
  it('ends the password loading state and allows retry after a timeout', async () => {
    const abort = vi.spyOn(XMLHttpRequest.prototype, 'abort')
    server.use(http.post('/api/v1/auth/login', async () => {
      await delay('infinite')
      return HttpResponse.json({})
    }))

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

    const submit = () => {
      fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'teacher@example.com' } })
      fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password' } })
      fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }))
    }
    submit()

    await waitFor(() => {
      expect(screen.getByText('The server took too long to respond. Please try again.')).toBeInTheDocument()
    }, { timeout: 12_000 })
    expect(abort).toHaveBeenCalled()
    expect(localStorage.getItem('auth_token')).toBeNull()
    expect(screen.getByRole('button', { name: /^sign in$/i })).toBeEnabled()

    server.use(http.post('/api/v1/auth/login', () => HttpResponse.json({
      access_token: 'retry-token',
      token_type: 'bearer',
      user_id: '00000000-0000-0000-0000-000000000001',
      display_name: 'Instructor Mark',
      role: 'instructor',
    })))
    submit()
    expect(await screen.findByText('Signed in successfully')).toBeInTheDocument()
    expect(localStorage.getItem('auth_token')).toBe('retry-token')
    client.clear()
  }, 15_000)
})
