import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getRepoSummaries, getContributorSummaries, generateSummary } from '@/services/api'
import type { GenerateSummaryData } from '@/types'

export const summaryKeys = {
  all: ['summaries'] as const,
  repoSummaries: (repoId: string) => ['summaries', 'repo', repoId] as const,
  contributorSummaries: (contributorId: string) => ['summaries', 'contributor', contributorId] as const,
}

export function useRepoSummaries(repoId: string) {
  return useQuery({
    queryKey: summaryKeys.repoSummaries(repoId),
    queryFn: () => getRepoSummaries(repoId),
    enabled: Boolean(repoId),
  })
}

export function useContributorSummaries(contributorId: string) {
  return useQuery({
    queryKey: summaryKeys.contributorSummaries(contributorId),
    queryFn: () => getContributorSummaries(contributorId),
    enabled: Boolean(contributorId),
  })
}

export function useGenerateSummary() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: GenerateSummaryData) => generateSummary(data),
    onSuccess: (_result, variables) => {
      if (variables.repo_id) {
        queryClient.invalidateQueries({ queryKey: summaryKeys.repoSummaries(variables.repo_id) })
      }
      if (variables.contributor_id) {
        queryClient.invalidateQueries({
          queryKey: summaryKeys.contributorSummaries(variables.contributor_id),
        })
      }
    },
  })
}
