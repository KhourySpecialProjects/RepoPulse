import { describe, it, expect, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useSyncRepo, useAddRepos, useDeleteRepo } from '@/hooks/useRepos'
import { useSyncCollection } from '@/hooks/useCollections'
import * as api from '@/services/api'
import type { ReactNode } from 'react'

vi.mock('@/services/api', async () => {
  const actual = await vi.importActual<typeof import('@/services/api')>('@/services/api')
  return {
    ...actual,
    syncRepo: vi.fn(),
    syncCollection: vi.fn(),
    addRepos: vi.fn(),
    deleteRepo: vi.fn(),
  }
})

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  return { wrapper, invalidateSpy }
}

type SpyLike = { mock: { calls: unknown[][] } }

/** True when some invalidated key starts with the given prefix. */
function invalidatedPrefix(spy: SpyLike, prefix: unknown[]) {
  return spy.mock.calls
    .map(call => (call[0] as { queryKey?: unknown[] } | undefined)?.queryKey)
    .some(key => Array.isArray(key) && prefix.every((part, i) => key[i] === part))
}

describe('useSyncRepo — refreshes the collection grid', () => {
  it('invalidates the collection repo list so RepoCard stops showing stale health', async () => {
    vi.mocked(api.syncRepo).mockResolvedValue({ detail: 'ok' } as never)
    const { wrapper, invalidateSpy } = setup()
    const { result } = renderHook(() => useSyncRepo(), { wrapper })

    act(() => {
      result.current.mutate('repo-1')
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    // RepoCard renders from ['repos','collection',id]
    expect(invalidatedPrefix(invalidateSpy, ['repos'])).toBe(true)
    expect(invalidatedPrefix(invalidateSpy, ['collections'])).toBe(true)
  })
})

describe('useSyncCollection — refreshes the repos it just synced', () => {
  it('invalidates repo queries, not just the collection detail', async () => {
    vi.mocked(api.syncCollection).mockResolvedValue({ detail: 'ok' } as never)
    const { wrapper, invalidateSpy } = setup()
    const { result } = renderHook(() => useSyncCollection(), { wrapper })

    act(() => {
      result.current.mutate('col-1')
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(invalidatedPrefix(invalidateSpy, ['repos'])).toBe(true)
  })
})

describe('repo add/remove — keeps the collection repo_count honest', () => {
  it('invalidates collection queries when repos are added', async () => {
    vi.mocked(api.addRepos).mockResolvedValue([] as never)
    const { wrapper, invalidateSpy } = setup()
    const { result } = renderHook(() => useAddRepos(), { wrapper })

    act(() => {
      result.current.mutate({ collectionId: 'col-1', urls: ['https://github.com/a/b'] })
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(invalidatedPrefix(invalidateSpy, ['collections'])).toBe(true)
  })

  it('invalidates collection queries when a repo is deleted', async () => {
    vi.mocked(api.deleteRepo).mockResolvedValue(undefined)
    const { wrapper, invalidateSpy } = setup()
    const { result } = renderHook(() => useDeleteRepo(), { wrapper })

    act(() => {
      result.current.mutate('repo-1')
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(invalidatedPrefix(invalidateSpy, ['collections'])).toBe(true)
  })
})
