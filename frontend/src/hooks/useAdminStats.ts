import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { toast } from 'sonner'

import {
  getAdminAttention,
  getAdminOverview,
  getAdminLlmUsage,
  getAdminPipeline,
  getAdminSystem,
  getAdminRepoStorage,
  getAdminStorage,
  getLlmConfig,
  getTokenUsage,
  getTokenUsageSummary,
  recalculateAdminStorage,
  setUserTokenLimit,
  updateLlmConfig,
} from '@/services/api'
import { formatBytes } from '@/lib/formatBytes'
import type {
  AdminRecalculateResult,
  AdminRepoSizeSort,
  UpdateLlmConfigData,
} from '@/types'

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
  pipeline: () => ['admin', 'pipeline'] as const,
  attention: (params?: {
    limit?: number
    offset?: number
    stale_after_days?: number
  }) => ['admin', 'attention', params ?? {}] as const,
  llmConfig: () => ['admin', 'llm-config'] as const,
  // Prefix and full key are separate entries because invalidateQueries
  // matches on prefix: passing the full key (which ends in a params object)
  // would only ever invalidate the one page whose params match exactly.
  tokenUsageAll: () => ['admin', 'token-usage'] as const,
  tokenUsage: (params?: { limit?: number; offset?: number }) =>
    ['admin', 'token-usage', params ?? {}] as const,
  tokenUsageSummary: () => ['admin', 'token-usage', 'summary'] as const,
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

/**
 * Ingestion health and data coverage. A snapshot, with no window.
 *
 * Sync state, the error groups, the age histogram and the coverage gaps are
 * all point-in-time. The endpoint briefly took a `days` window, but that only
 * ever scoped an email-delivery figure that no longer exists — so a range
 * argument here would refetch identical data and imply a scope the response
 * does not have.
 *
 * No `keepPreviousData` for the same reason: the key never changes, so there
 * is no previous window to hold on to.
 */
export function useAdminPipeline() {
  return useQuery({
    queryKey: adminKeys.pipeline(),
    queryFn: getAdminPipeline,
  })
}

/**
 * `placeholderData: keepPreviousData` lets a list hold its previous render
 * while new data loads, instead of unmounting into a skeleton and taking the
 * layout with it.
 */

export function useAdminAttention(params?: {
  limit?: number
  offset?: number
  stale_after_days?: number
}) {
  return useQuery({
    queryKey: adminKeys.attention(params),
    queryFn: () => getAdminAttention(params),
    placeholderData: keepPreviousData,
  })
}

// ---------------------------------------------------------------------------
// Shared LLM config and token limits
// ---------------------------------------------------------------------------

export function useLlmConfig() {
  return useQuery({
    queryKey: adminKeys.llmConfig(),
    queryFn: getLlmConfig,
  })
}

export function useUpdateLlmConfig() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: UpdateLlmConfigData) => updateLlmConfig(data),
    onSuccess: () => {
      // Invalidates the whole admin tree, not just the config: changing the
      // default limit changes every row of the token-usage table that had no
      // override, and those are resolved server-side.
      queryClient.invalidateQueries({ queryKey: adminKeys.all })
      // The Settings page shows the model this picks, and any user's own
      // quota readout is now stale too.
      queryClient.invalidateQueries({ queryKey: ['settings'] })
      toast.success('AI settings saved')
    },
    onError: () => toast.error('Could not save AI settings. Please try again.'),
  })
}

/**
 * Instance-wide token spend and cost for the current month.
 *
 * Shares the `['admin', 'token-usage']` prefix with the per-user list, so
 * saving a rate or a limit invalidates both with one call.
 */
export function useAdminTokenUsageSummary() {
  return useQuery({
    queryKey: adminKeys.tokenUsageSummary(),
    queryFn: getTokenUsageSummary,
  })
}

export function useAdminTokenUsage(params?: {
  limit?: number
  offset?: number
}) {
  return useQuery({
    queryKey: adminKeys.tokenUsage(params),
    queryFn: () => getTokenUsage(params),
    placeholderData: keepPreviousData,
  })
}

export function useSetUserTokenLimit() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      userId,
      monthlyTokenLimit,
    }: {
      userId: string
      monthlyTokenLimit: number | null
    }) => setUserTokenLimit(userId, monthlyTokenLimit),
    onSuccess: (row) => {
      queryClient.invalidateQueries({ queryKey: adminKeys.tokenUsageAll() })
      queryClient.invalidateQueries({ queryKey: ['settings'] })
      toast.success(
        row.unlimited
          ? `${row.display_name} is not metered`
          : row.override === null
            ? `${row.display_name} now follows the instance default`
            : `${row.display_name}: ${row.override.toLocaleString()} tokens/month`,
      )
    },
    onError: () => toast.error('Could not update the limit. Please try again.'),
  })
}
