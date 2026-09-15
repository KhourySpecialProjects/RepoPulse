import { useQueries, useQuery } from '@tanstack/react-query'
import { getCollections, getRepos } from '@/services/api'
import { useWorkspaceCommitActivity } from '@/hooks/useCollections'
import type { PaginatedResponse } from '@/types'

async function allPages<T>(fetchPage: (offset: number) => Promise<PaginatedResponse<T>>) {
  const items: T[] = []
  for (;;) {
    const page = await fetchPage(items.length)
    items.push(...page.items)
    if (!page.items.length || items.length >= page.total) return items
  }
}

export function useDashboard(collectionId: string) {
  const collectionsQuery = useQuery({
    queryKey: ['collections', 'dashboard'],
    queryFn: () => allPages(offset => getCollections(50, offset)),
  })
  const collections = collectionsQuery.data ?? []
  const selected = collections.filter(collection => !collectionId || collection.id === collectionId)
  const repoQueries = useQueries({ queries: selected.map(collection => ({
    queryKey: ['repos', 'dashboard', collection.id],
    queryFn: () => allPages(offset => getRepos(collection.id, 50, offset)),
  })) })
  const activityQuery = useWorkspaceCommitActivity(selected.map(collection => collection.id))

  return {
    collections,
    selected,
    repos: repoQueries.flatMap(query => query.data ?? []),
    loading: collectionsQuery.isPending || repoQueries.some(query => query.isPending),
    failed: collectionsQuery.isError || repoQueries.some(query => query.isError),
    refreshing: collectionsQuery.isFetching || repoQueries.some(query => query.isFetching) || activityQuery.isFetching,
    activityQuery,
    refresh: () => Promise.all([
      collectionsQuery.refetch(),
      ...repoQueries.map(query => query.refetch()),
      activityQuery.refetch(),
    ]),
  }
}
