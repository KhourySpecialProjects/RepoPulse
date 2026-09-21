import { cn } from '@/lib/utils'
import type { CommitQualityScore } from '@/types'

const SCORE_CONFIG: Record<CommitQualityScore, { label: string; className: string }> = {
  good: { label: 'Good', className: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  ok: { label: 'OK', className: 'bg-yellow-100 text-yellow-700 border-yellow-200' },
  bad: { label: 'Bad', className: 'bg-red-100 text-red-700 border-red-200' },
}

// Kept out of the map on purpose. Falling back to OK would undo the point of
// the backend returning null: an unscored commit would be indistinguishable
// from a genuinely mediocre one.
const UNSCORED = { label: '—', className: 'bg-gray-100 text-gray-400 border-gray-200' }

export function CommitScorePill({
  score,
  className,
}: {
  score: CommitQualityScore | null
  className?: string
}) {
  const cfg = (score && SCORE_CONFIG[score]) || UNSCORED
  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border',
        cfg.className,
        className
      )}
      title={score ? undefined : 'Not scored yet'}
    >
      {cfg.label}
    </span>
  )
}
