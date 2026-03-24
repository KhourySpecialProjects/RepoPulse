import { useState } from 'react'
import { Trash2, MessageSquare, ChevronDown, ChevronUp } from 'lucide-react'
import { useNoteComments, useCreateNoteComment, useDeleteNoteComment } from '@/hooks/useNoteComments'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import type { Note } from '@/types'

interface NoteCommentsProps {
  note: Note
  currentUserId: string
  currentUserRole?: 'instructor' | 'ta' | 'admin'
}

function formatTimeAgo(isoStr: string): string {
  const ms = Date.now() - new Date(isoStr).getTime()
  const minutes = Math.floor(ms / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(isoStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((part) => part[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

export function NoteComments({ note, currentUserId, currentUserRole }: NoteCommentsProps) {
  const { data: comments = [], isLoading } = useNoteComments(note.id)
  const createComment = useCreateNoteComment()
  const deleteComment = useDeleteNoteComment()

  const [expanded, setExpanded] = useState(false)
  const [replyText, setReplyText] = useState('')
  const [isReplying, setIsReplying] = useState(false)

  const visibleCount = comments.length

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!replyText.trim()) return
    try {
      await createComment.mutateAsync({ noteId: note.id, content: replyText.trim() })
      setReplyText('')
      setIsReplying(false)
      setExpanded(true)
    } catch {
      toast.error('Failed to add comment')
    }
  }

  async function handleDelete(commentId: string) {
    try {
      await deleteComment.mutateAsync({ noteId: note.id, commentId })
    } catch {
      toast.error('Failed to delete comment')
    }
  }

  if (isLoading) return null

  return (
    <div className="mt-2">
      {/* Toggle for existing comments */}
      {visibleCount > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mb-1"
        >
          <MessageSquare className="h-3 w-3" />
          <span>
            {visibleCount} comment{visibleCount !== 1 ? 's' : ''}
          </span>
          {expanded ? (
            <ChevronUp className="h-3 w-3" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          )}
        </button>
      )}

      {/* Expanded comments list */}
      {expanded && visibleCount > 0 && (
        <div className="flex flex-col gap-2 mb-2 pl-2 border-l-2 border-border">
          {comments.map((comment) => {
            const canDelete =
              comment.author_id === currentUserId || currentUserRole === 'admin'
            return (
              <div key={comment.id} className="flex gap-2 items-start">
                <div className="flex-shrink-0 w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 text-[10px] font-semibold flex items-center justify-center">
                  {getInitials(comment.author_display_name)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-1.5 flex-wrap">
                    <span className="text-xs font-semibold text-foreground">
                      {comment.author_display_name}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {formatTimeAgo(comment.created_at)}
                    </span>
                  </div>
                  <p className="text-xs text-foreground leading-snug">{comment.content}</p>
                </div>
                {canDelete && (
                  <button
                    type="button"
                    onClick={() => handleDelete(comment.id)}
                    disabled={deleteComment.isPending}
                    className="flex-shrink-0 text-muted-foreground hover:text-red-500 transition-colors disabled:opacity-40"
                    title="Delete comment"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Add comment */}
      {!isReplying && (
        <button
          type="button"
          onClick={() => setIsReplying(true)}
          className="text-xs text-muted-foreground hover:text-indigo-600 transition-colors"
        >
          Reply
        </button>
      )}
      {isReplying && (
        <form onSubmit={handleSubmit} className="flex flex-col gap-1.5 mt-1">
          <Textarea
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            placeholder="Add a comment..."
            className="text-xs min-h-[56px] resize-none"
            autoFocus
          />
          <div className="flex items-center gap-2">
            <Button
              type="submit"
              size="sm"
              disabled={createComment.isPending || !replyText.trim()}
              className={cn('text-xs h-6 px-2 bg-indigo-600 hover:bg-indigo-700 text-white border-0')}
            >
              {createComment.isPending ? 'Posting...' : 'Reply'}
            </Button>
            <button
              type="button"
              onClick={() => {
                setIsReplying(false)
                setReplyText('')
              }}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
