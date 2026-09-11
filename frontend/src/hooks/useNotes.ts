import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getNotes, createNote, updateNote, deleteNote } from '@/services/api'
import type { CreateNoteData, UpdateNoteData, GetNotesParams } from '@/types'

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
      queryClient.invalidateQueries({ queryKey: noteKeys.all })
    },
  })
}

export function useUpdateNote() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateNoteData }) => updateNote(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: noteKeys.all })
    },
  })
}

export function useDeleteNote() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteNote(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: noteKeys.all })
    },
  })
}

// Re-export useUsers from useUsers.ts for backwards compatibility
export { useUsers } from '@/hooks/useUsers'
