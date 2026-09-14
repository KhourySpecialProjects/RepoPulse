import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import { getNotes, createNote, updateNote, deleteNote } from '@/services/api'
import type { CreateNoteData, UpdateNoteData, GetNotesParams } from '@/types'

/**
 * Notes feed several other caches: mentions create notifications, reminders
 * appear in the notifications panel, and repos carry active_reminder_count.
 * Invalidating only ['notes'] leaves all of those stale.
 */
function invalidateNoteDependents(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: noteKeys.all })
  queryClient.invalidateQueries({ queryKey: ['notifications'] })
  queryClient.invalidateQueries({ queryKey: ['repos'] })
}

export const noteKeys = {
  all: ['notes'] as const,
  list: (params?: GetNotesParams) => ['notes', 'list', params] as const,
}

export function useNotes(params?: GetNotesParams) {
  return useQuery({
    queryKey: noteKeys.list(params),
    queryFn: () => getNotes(params),
  })
}

export function useCreateNote() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateNoteData) => createNote(data),
    onSuccess: () => {
      invalidateNoteDependents(queryClient)
    },
  })
}

export function useUpdateNote() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateNoteData }) => updateNote(id, data),
    onSuccess: () => {
      invalidateNoteDependents(queryClient)
    },
  })
}

export function useDeleteNote() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteNote(id),
    onSuccess: () => {
      invalidateNoteDependents(queryClient)
    },
  })
}

// Re-export useUsers from useUsers.ts for backwards compatibility
export { useUsers } from '@/hooks/useUsers'
