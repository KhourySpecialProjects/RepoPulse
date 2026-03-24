import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getCollectionAccess, addCollectionAccess, removeCollectionAccess } from '@/services/api'

export function useCollectionAccess(collectionId: string) {
  return useQuery({
    queryKey: ['collection-access', collectionId],
    queryFn: () => getCollectionAccess(collectionId),
    staleTime: 30_000,
    enabled: !!collectionId,
  })
}

export function useAddCollectionAccess() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      collectionId,
      userId,
      accessRole,
    }: {
      collectionId: string
      userId: string
      accessRole: 'co_instructor' | 'ta'
    }) => addCollectionAccess(collectionId, userId, accessRole),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['collection-access', variables.collectionId] })
    },
  })
}

export function useRemoveCollectionAccess() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ collectionId, userId }: { collectionId: string; userId: string }) =>
      removeCollectionAccess(collectionId, userId),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['collection-access', variables.collectionId] })
    },
  })
}
