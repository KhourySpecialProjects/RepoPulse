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
} from '@/services/api'
import type { GetCommitsParams } from '@/types'

export const repoKeys = {
  all: ['repos'] as const,
  byCollection: (collectionId: string) => ['repos', 'collection', collectionId] as const,
  detail: (id: string) => ['repos', 'detail', id] as const,
  health: (id: string) => ['repos', 'health', id] as const,
  commits: (id: string, params?: GetCommitsParams) => ['repos', 'commits', id, params] as const,
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
