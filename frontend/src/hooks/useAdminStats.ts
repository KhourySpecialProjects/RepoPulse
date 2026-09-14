import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  getAdminOverview,
  getAdminLlmUsage,
  getAdminSystem,
  getAdminRepoStorage,
  getAdminStorage,
  recalculateAdminStorage,
} from '@/services/api'
import type { AdminRepoSizeSort } from '@/types'

/**
 * Query keys for the admin dashboard.
 *
 * A factory rather than inline literals, following useSettings/useRepos —
 * useUsers uses inline `['users', params]` strings and is the pattern not to
 * copy, since a typo there silently creates a second cache entry.
 */
export const adminKeys = {
  all: ['admin'] as const,
  overview: (staleAfterDays: number) =>
    ['admin', 'overview', staleAfterDays] as const,
  system: () => ['admin', 'system'] as const,
  llmUsage: (days: number) => ['admin', 'llm-usage', days] as const,
  storage: (includeOrphanSize: boolean) =>
    ['admin', 'storage', includeOrphanSize] as const,
  repoStorage: (params?: {
    limit?: number
    offset?: number
    sort?: AdminRepoSizeSort
    collection_id?: string
  }) => ['admin', 'storage', 'repos', params ?? {}] as const,
}

export function useAdminOverview(staleAfterDays = 7) {
  return useQuery({
    queryKey: adminKeys.overview(staleAfterDays),
    queryFn: () => getAdminOverview(staleAfterDays),
  })
}

export function useAdminSystem() {
  return useQuery({
    queryKey: adminKeys.system(),
    queryFn: getAdminSystem,
  })
}

export function useAdminLlmUsage(days = 30) {
  return useQuery({
    queryKey: adminKeys.llmUsage(days),
    queryFn: () => getAdminLlmUsage(days),
  })
}

export function useAdminStorage(includeOrphanSize = false) {
  return useQuery({
    queryKey: adminKeys.storage(includeOrphanSize),
    queryFn: () => getAdminStorage(includeOrphanSize),
  })
}

export function useAdminRepoStorage(params?: {
  limit?: number
  offset?: number
  sort?: AdminRepoSizeSort
  collection_id?: string
}) {
  return useQuery({
    queryKey: adminKeys.repoStorage(params),
    queryFn: () => getAdminRepoStorage(params),
  })
}

export function useRecalculateAdminStorage() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: recalculateAdminStorage,
    onSuccess: () => {
      // Recalculate is synchronous, so by the time this fires the new sizes
      // are already readable — invalidating everything under `admin` picks up
      // both the summary totals and the per-repo list.
      queryClient.invalidateQueries({ queryKey: adminKeys.all })
    },
  })
}
