import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getMyTokenUsage, getSettings, updateSettings } from '@/services/api'
import type { UpdateSettingsData } from '@/types'

export const settingsKeys = {
  all: ['settings'] as const,
  tokenUsage: () => ['settings', 'token-usage'] as const,
}

export function useSettings() {
  return useQuery({
    queryKey: settingsKeys.all,
    queryFn: getSettings,
  })
}

/**
 * The signed-in user's own AI token usage for the current month.
 *
 * Kept short-lived: every summary or classification the user runs spends
 * against it, so a long-cached figure would show them a number they have
 * already moved past — and the one moment they look at it is right after a
 * refusal.
 */
export function useMyTokenUsage() {
  return useQuery({
    queryKey: settingsKeys.tokenUsage(),
    queryFn: getMyTokenUsage,
    staleTime: 30_000,
  })
}

export function useUpdateSettings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: UpdateSettingsData) => updateSettings(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: settingsKeys.all })
    },
  })
}
