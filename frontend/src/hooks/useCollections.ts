import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getCollections,
  getCollection,
  createCollection,
  updateCollection,
  deleteCollection,
  syncCollection,
  getCollectionCommitActivity,
} from '@/services/api'
import type { CreateCollectionData, UpdateCollectionData } from '@/types'

export const collectionKeys = {
  all: ['collections'] as const,
  list: (limit: number, offset: number) => ['collections', 'list', limit, offset] as const,
  detail: (id: string) => ['collections', 'detail', id] as const,
}

export function useCollections(limit = 50, offset = 0, includeArchived = false) {
  return useQuery({
    queryKey: [...collectionKeys.list(limit, offset), includeArchived] as const,
    queryFn: () => getCollections(limit, offset, includeArchived),
  })
}

export function useCollection(id: string) {
  return useQuery({
    queryKey: collectionKeys.detail(id),
    queryFn: () => getCollection(id),
    enabled: Boolean(id),
  })
}

export function useCreateCollection() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateCollectionData) => createCollection(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: collectionKeys.all })
    },
  })
}

export function useUpdateCollection() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateCollectionData }) => updateCollection(id, data),
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: collectionKeys.all })
      queryClient.invalidateQueries({ queryKey: collectionKeys.detail(variables.id) })
    },
  })
}

export function useDeleteCollection() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteCollection(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: collectionKeys.all })
    },
  })
}

export function useSyncCollection() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => syncCollection(id),
    onSuccess: (_result, id) => {
      queryClient.invalidateQueries({ queryKey: collectionKeys.detail(id) })
    },
  })
}

export function useCollectionCommitActivity(collectionId: string) {
  return useQuery({
    queryKey: ['collections', collectionId, 'commit-activity'],
    queryFn: () => getCollectionCommitActivity(collectionId),
    enabled: Boolean(collectionId),
  })
}
