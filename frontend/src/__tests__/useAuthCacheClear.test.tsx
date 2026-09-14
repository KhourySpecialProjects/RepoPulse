import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { AuthProvider, useAuth } from '@/hooks/useAuth'

const mockDevLogin = vi.fn()
const mockLogin = vi.fn()
vi.mock('@/services/api', () => ({
  devLogin: (...args: unknown[]) => mockDevLogin(...args),
  login: (...args: unknown[]) => mockLogin(...args),
  setAuthToken: vi.fn(),
  clearAuthToken: vi.fn(),
}))

function makeWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <AuthProvider>{children}</AuthProvider>
      </QueryClientProvider>
    )
  }
}

describe('useAuth query cache isolation across user switches', () => {
  beforeEach(() => {
    localStorage.clear()
    mockDevLogin.mockReset()
    mockLogin.mockReset()
  })

  it('clears the React Query cache on devLogin so the next user does not see stale data', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: false } } })
    // Simulate a cached "collections" list belonging to the professor.
    queryClient.setQueryData(['collections', 'list', 50, 0, false], {
      items: [{ id: '1' }, { id: '2' }, { id: '3' }],
      total: 3,
    })

    mockDevLogin.mockResolvedValueOnce({
      access_token: 'ta-token',
      user_id: 'ta-1',
      display_name: 'TA Sarah',
      role: 'ta',
    })

    const { result } = renderHook(() => useAuth(), { wrapper: makeWrapper(queryClient) })

    await act(async () => {
      await result.current.devLogin('ta-1')
    })

    expect(queryClient.getQueryData(['collections', 'list', 50, 0, false])).toBeUndefined()
  })

  it('clears the React Query cache on logout', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: false } } })
    queryClient.setQueryData(['collections', 'list', 50, 0, false], { items: [{ id: '1' }], total: 1 })

    const { result } = renderHook(() => useAuth(), { wrapper: makeWrapper(queryClient) })

    act(() => {
      result.current.logout()
    })

    expect(queryClient.getQueryData(['collections', 'list', 50, 0, false])).toBeUndefined()
  })

  it('does not leak a previously cached collections list into the next logged-in user', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: false } } })
    queryClient.setQueryData(['collections', 'list', 50, 0, false], {
      items: [{ id: 'prof-1' }, { id: 'prof-2' }, { id: 'prof-3' }],
      total: 3,
    })

    mockLogin.mockResolvedValueOnce({
      access_token: 'ta-token',
      user_id: 'ta-1',
      display_name: 'TA Sarah',
      role: 'ta',
    })

    const { result } = renderHook(() => useAuth(), { wrapper: makeWrapper(queryClient) })

    await act(async () => {
      await result.current.login('ta@example.com', 'pw')
    })

    const cached = queryClient.getQueryData(['collections', 'list', 50, 0, false])
    expect(cached).toBeUndefined()
  })
})
