import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getNoteComments, createNoteComment, deleteNoteComment } from '@/services/api'

export function useNoteComments(noteId: string) {
  return useQuery({
    queryKey: ['note-comments', noteId],
    queryFn: () => getNoteComments(noteId),
    staleTime: 30_000,
    enabled: !!noteId,
  })
}

export function useCreateNoteComment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ noteId, content }: { noteId: string; content: string }) =>
      createNoteComment(noteId, content),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['note-comments', variables.noteId] })
      qc.invalidateQueries({ queryKey: ['notes'] })
    },
  })
}

export function useDeleteNoteComment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ noteId, commentId }: { noteId: string; commentId: string }) =>
      deleteNoteComment(noteId, commentId),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['note-comments', variables.noteId] })
      qc.invalidateQueries({ queryKey: ['notes'] })
    },
  })
}
