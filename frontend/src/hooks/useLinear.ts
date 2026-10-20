import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { isAxiosError } from 'axios'
import { getLinearTeams, getRepoLinear, patchRepo } from '@/services/api'
import type { ApiErrorBody } from '@/types'
import { repoKeys } from '@/hooks/useRepos'

export const linearKeys = {
  all: ['linear'] as const,
  repo: (repoId: string) => ['linear', 'repo', repoId] as const,
  teams: ['linear', 'teams'] as const,
}

// Linear is read live on every panel load, so a short cache saves the two
// API calls behind it when someone flips between repos.
const LINEAR_STALE_MS = 5 * 60_000

/** The backend's error_code for a failed Linear request, if there is one. */
export function linearErrorCode(error: unknown): string | undefined {
  if (!isAxiosError<ApiErrorBody>(error)) return undefined
  return error.response?.data?.error_code
}

export function useRepoLinear(repoId: string) {
  return useQuery({
    queryKey: linearKeys.repo(repoId),
    queryFn: () => getRepoLinear(repoId),
    enabled: Boolean(repoId),
    staleTime: LINEAR_STALE_MS,
    // A rejected key fails the same way every time; the panel offers a manual
    // retry for outages instead.
    retry: false,
  })
}

export function useLinearTeams(enabled: boolean) {
  return useQuery({
    queryKey: linearKeys.teams,
    queryFn: getLinearTeams,
    enabled,
    staleTime: LINEAR_STALE_MS,
    retry: false,
  })
}

export function useLinkLinearTeam(repoId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (teamId: string | null) => patchRepo(repoId, { linear_team_id: teamId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: linearKeys.repo(repoId) })
      queryClient.invalidateQueries({ queryKey: repoKeys.detail(repoId) })
    },
  })
}
