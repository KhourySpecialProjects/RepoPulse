import { useQuery } from '@tanstack/react-query'
import { getContextualActivity } from '@/services/api'

export function useContextualActivity(collectionId: string) {
  return useQuery({
    queryKey: ['repos', 'contextual-activity', collectionId],
    queryFn: () => getContextualActivity(collectionId),
    enabled: Boolean(collectionId),
  })
}
