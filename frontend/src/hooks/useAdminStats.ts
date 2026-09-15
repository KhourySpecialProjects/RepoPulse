import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import {
  getAdminOverview,
  getAdminLlmUsage,
  getAdminSystem,
  getAdminRepoStorage,
  getAdminStorage,
  recalculateAdminStorage,
} from '@/services/api'
import { formatBytes } from '@/lib/formatBytes'
import type { AdminRecalculateResult, AdminRepoSizeSort } from '@/types'

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

/**
 * Summarise a recalculate for a toast.
 *
 * `measured` on its own is the number that misleads: a run over five repos
 * that measures three is reported identically to one over three that measured
 * all of them. Both shortfalls therefore get named, and only when non-zero —
 * a healthy instance should read as one clean clause, not a list of zeros.
 */
function recalculateSummary(result: AdminRecalculateResult): string {
  const parts = [
    `Measured ${result.measured} of ${result.requested} repo${
      result.requested === 1 ? '' : 's'
    } · ${formatBytes(result.total_bytes)}`,
  ]
  if (result.skipped_missing > 0) {
    parts.push(
      `${result.skipped_missing} clone${
        result.skipped_missing === 1 ? '' : 's'
      } missing`,
    )
  }
  if (result.failed > 0) {
    parts.push(`${result.failed} failed`)
  }
  return parts.join(' · ')
}

export function useRecalculateAdminStorage() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: recalculateAdminStorage,
    onSuccess: (result) => {
      // Recalculate is synchronous, so by the time this fires the new sizes
      // are already readable — invalidating everything under `admin` picks up
      // both the summary totals and the per-repo list.
      queryClient.invalidateQueries({ queryKey: adminKeys.all })
      toast.success(recalculateSummary(result))
    },
    onError: () =>
      toast.error('Could not measure clone sizes. Please try again.'),
  })
}
