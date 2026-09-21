import { useQueries } from '@tanstack/react-query'
import { getContextualActivity } from '@/services/api'
import type { PersonEntry } from '@/lib/dashboardSearch'

/**
 * Every contributor across the given collections, paired with their repository.
 *
 * There is no workspace-wide people endpoint — contributors are only exposed
 * per repo — but the contextual-activity endpoint already returns each
 * collection's repos *with* their students, so this is one request per
 * collection instead of one per repository.
 *
 * `enabled` is the point of the hook: that endpoint walks git history, so it
 * stays unfetched until someone actually types into the search box. The query
 * keys match `useContextualActivity`, so a collection page opened afterwards
 * reuses this instead of re-reading the history.
 */
export function useWorkspacePeople(collectionIds: string[], enabled: boolean) {
  const queries = useQueries({
    queries: collectionIds.map(id => ({
      queryKey: ['repos', 'contextual-activity', id],
      queryFn: () => getContextualActivity(id),
      enabled,
      staleTime: 5 * 60 * 1000,
    })),
  })

  const people: PersonEntry[] = queries.flatMap(query =>
    (query.data?.repositories ?? []).flatMap(repository =>
      repository.students.map(student => ({
        id: student.id,
        name: student.name,
        repoId: repository.id,
        repoName: repository.name,
      }))
    )
  )

  return {
    people,
    isPending: enabled && queries.some(query => query.isPending),
  }
}
