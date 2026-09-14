import { useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getRepos,
  getRepo,
  addRepos,
  syncRepo,
  deleteRepo,
  getRepoHealth,
  getRepoCommits,
  getRepoContributors,
  updateContributor,
  mergeContributors,
  unmergeContributor,
  patchRepo,
  getPullRequests,
  getPRStats,
  syncPullRequests,
  classifyRepoCommits,
} from '@/services/api'
import type { GetCommitsParams, SyncStatus } from '@/types'
import { toast } from 'sonner'

export const repoKeys = {
  all: ['repos'] as const,
  byCollection: (collectionId: string) => ['repos', 'collection', collectionId] as const,
  detail: (id: string) => ['repos', 'detail', id] as const,
  health: (id: string) => ['repos', 'health', id] as const,
  commits: (id: string, params?: GetCommitsParams) =>
    params !== undefined
      ? (['repos', 'commits', id, params] as const)
      : (['repos', 'commits', id] as const),
  contributors: (id: string) => ['repos', 'contributors', id] as const,
}

/**
 * How often to re-check while a sync is running somewhere.
 *
 * Sync state is shared, so the viewer who started it is not necessarily the
 * one watching. Polling only while something is actually in flight keeps an
 * idle dashboard quiet — the interval callback returns false the moment every
 * repo reports back idle.
 */
const SYNC_POLL_MS = 4000

export function useRepos(collectionId: string, limit = 50, offset = 0) {
  return useQuery({
    queryKey: repoKeys.byCollection(collectionId),
    queryFn: () => getRepos(collectionId, limit, offset),
    enabled: Boolean(collectionId),
    refetchInterval: (query) =>
      query.state.data?.items.some((repo) => repo.sync_status === 'syncing')
        ? SYNC_POLL_MS
        : false,
  })
}

export function useRepo(id: string) {
  const queryClient = useQueryClient()
  const previousStatus = useRef<SyncStatus | undefined>(undefined)

  const query = useQuery({
    queryKey: repoKeys.detail(id),
    queryFn: () => getRepo(id),
    enabled: Boolean(id),
    refetchInterval: (q) =>
      q.state.data?.sync_status === 'syncing' ? SYNC_POLL_MS : false,
  })

  // Polling refreshes the repo itself, but commits and contributors are
  // separate queries and would keep serving pre-sync data. Invalidate them on
  // the syncing → settled edge, which is the only moment new data exists.
  const status = query.data?.sync_status
  useEffect(() => {
    if (previousStatus.current === 'syncing' && status && status !== 'syncing') {
      queryClient.invalidateQueries({ queryKey: repoKeys.commits(id) })
      queryClient.invalidateQueries({ queryKey: repoKeys.contributors(id) })
      queryClient.invalidateQueries({ queryKey: repoKeys.health(id) })
    }
    previousStatus.current = status
  }, [status, id, queryClient])

  return query
}

/** The full commit list RepoDetailPage loads to locate a commit's page. */
export const ALL_COMMITS_PARAMS: GetCommitsParams = { limit: 500, offset: 0 }

/**
 * Warm the queries RepoDetailPage blocks on, before the user navigates.
 *
 * Jumping to a reminder's commit needs the whole commit list, because the page
 * number a commit falls on can only be derived from its index. Fetched cold on
 * arrival that is the slowest thing on the page, and the jump cannot happen
 * until it lands. Calling this on hover or focus of a link means the cache is
 * usually already warm by the time the click registers.
 *
 * `prefetchQuery` is a no-op when the data is present and unstale, so calling
 * it on every pointer event is cheap.
 */
export function usePrefetchRepo() {
  const queryClient = useQueryClient()

  return (id: string) => {
    if (!id) return
    void queryClient.prefetchQuery({
      queryKey: repoKeys.detail(id),
      queryFn: () => getRepo(id),
    })
    void queryClient.prefetchQuery({
      queryKey: repoKeys.commits(id, ALL_COMMITS_PARAMS),
      queryFn: () => getRepoCommits(id, ALL_COMMITS_PARAMS),
    })
  }
}

export function useAddRepos() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ collectionId, urls }: { collectionId: string; urls: string[] }) =>
      addRepos(collectionId, urls),
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: repoKeys.byCollection(variables.collectionId) })
    },
  })
}

export function useSyncRepo() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => syncRepo(id),
    onSuccess: (_result, id) => {
      queryClient.invalidateQueries({ queryKey: repoKeys.detail(id) })
      queryClient.invalidateQueries({ queryKey: repoKeys.health(id) })
      queryClient.invalidateQueries({ queryKey: repoKeys.commits(id) })
      queryClient.invalidateQueries({ queryKey: repoKeys.contributors(id) })
      queryClient.invalidateQueries({ queryKey: ['repos', 'contextual-activity'] })
    },
  })
}

export function useDeleteRepo() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteRepo(id),
    onSuccess: (_result, id) => {
      queryClient.invalidateQueries({ queryKey: ['repos'] })
      queryClient.invalidateQueries({ queryKey: repoKeys.detail(id) })
    },
  })
}

export function useRepoHealth(id: string) {
  return useQuery({
    queryKey: repoKeys.health(id),
    queryFn: () => getRepoHealth(id),
    enabled: Boolean(id),
  })
}

export function useRepoCommits(id: string, params?: GetCommitsParams) {
  return useQuery({
    queryKey: repoKeys.commits(id, params),
    queryFn: () => getRepoCommits(id, params),
    enabled: Boolean(id),
  })
}

export function useRepoContributors(id: string) {
  return useQuery({
    queryKey: repoKeys.contributors(id),
    queryFn: () => getRepoContributors(id),
    enabled: Boolean(id),
  })
}

export function useUpdateContributor(repoId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, displayName }: { id: string; displayName: string }) =>
      updateContributor(id, displayName),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: repoKeys.contributors(repoId) })
      queryClient.invalidateQueries({ queryKey: ['repos', 'contextual-activity'] })
    },
  })
}

export function useUnmergeContributor(repoId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: unmergeContributor,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: repoKeys.contributors(repoId) }),
        queryClient.invalidateQueries({ queryKey: ['repos', 'contextual-activity'] }),
        queryClient.invalidateQueries({ queryKey: repoKeys.detail(repoId) }),
        queryClient.invalidateQueries({ queryKey: ['notes'] }),
        queryClient.invalidateQueries({ queryKey: ['summaries'] }),
      ])
      toast.success('Last merge undone')
    },
    onError: () => toast.error('Could not undo this merge. Refresh and try again.'),
  })
}

export function useMergeContributors(repoId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ ids, displayName }: { ids: string[]; displayName: string }) =>
      mergeContributors(ids, displayName),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: repoKeys.contributors(repoId) })
      queryClient.invalidateQueries({ queryKey: ['repos', 'contextual-activity'] })
    },
  })
}

export function usePatchRepo() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: { expected_contributor_count?: number | null } }) =>
      patchRepo(id, data),
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: repoKeys.detail(variables.id) })
      queryClient.invalidateQueries({ queryKey: repoKeys.health(variables.id) })
    },
  })
}

export function usePRStats(repoId: string) {
  return useQuery({
    queryKey: ['pr-stats', repoId],
    queryFn: () => getPRStats(repoId),
    enabled: Boolean(repoId),
    staleTime: 60_000,
  })
}

export function usePullRequests(repoId: string, state?: string, limit = 10, offset = 0) {
  return useQuery({
    queryKey: ['pull-requests', repoId, state, limit, offset],
    queryFn: () => getPullRequests(repoId, state, limit, offset),
    enabled: Boolean(repoId),
    staleTime: 60_000,
  })
}

/** Classify a repo's commits.
 *
 * The mutation variable is `confirm`. A first call sends `false`; if the
 * backend answers `status: 'preview'` nothing was written and the caller is
 * expected to confirm, so that case must NOT invalidate — refetching there
 * would imply work happened. Toasts live at the call site because the flow is
 * two-phase and the copy depends on the returned counters.
 */
export function useClassifyCommits(repoId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (confirm: boolean) => classifyRepoCommits(repoId, confirm),
    onSuccess: (result) => {
      if (result.status === 'completed' && result.classified > 0) {
        queryClient.invalidateQueries({ queryKey: repoKeys.commits(repoId) })
      }
    },
  })
}

export function useSyncPullRequests(repoId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => syncPullRequests(repoId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pull-requests', repoId] })
      queryClient.invalidateQueries({ queryKey: ['pr-stats', repoId] })
      toast.success('Pull requests synced')
    },
    onError: () => toast.error('Failed to sync pull requests'),
  })
}
