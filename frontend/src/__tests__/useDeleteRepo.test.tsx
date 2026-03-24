import { describe, it, expect, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useDeleteRepo } from '@/hooks/useRepos'
import * as api from '@/services/api'
import type { ReactNode } from 'react'

vi.mock('@/services/api', async () => {
  const actual = await vi.importActual<typeof import('@/services/api')>('@/services/api')
  return { ...actual, deleteRepo: vi.fn() }
})

function makeWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

describe('useDeleteRepo', () => {
  it('calls deleteRepo with the repo id', async () => {
    const mockDelete = vi.mocked(api.deleteRepo).mockResolvedValue(undefined)
    const { result } = renderHook(() => useDeleteRepo(), { wrapper: makeWrapper() })

    act(() => {
      result.current.mutate('repo-1')
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockDelete).toHaveBeenCalledWith('repo-1')
  })

  it('invalidates repos and repo detail queries on success', async () => {
    vi.mocked(api.deleteRepo).mockResolvedValue(undefined)
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    const { result } = renderHook(() => useDeleteRepo(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      ),
    })

    act(() => {
      result.current.mutate('repo-42')
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    const calledKeys = invalidateSpy.mock.calls.map((call) => call[0])
    expect(calledKeys).toContainEqual({ queryKey: ['repos'] })
    expect(calledKeys).toContainEqual({ queryKey: ['repos', 'detail', 'repo-42'] })
  })
})
