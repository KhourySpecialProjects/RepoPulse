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
  patchRepo,
  getPullRequests,
  getPRStats,
  syncPullRequests,
  classifyRepoCommits,
} from '@/services/api'
import type { GetCommitsParams } from '@/types'
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

export function useRepos(collectionId: string, limit = 50, offset = 0) {
  return useQuery({
    queryKey: repoKeys.byCollection(collectionId),
    queryFn: () => getRepos(collectionId, limit, offset),
    enabled: Boolean(collectionId),
  })
}

export function useRepo(id: string) {
  return useQuery({
    queryKey: repoKeys.detail(id),
    queryFn: () => getRepo(id),
    enabled: Boolean(id),
  })
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
