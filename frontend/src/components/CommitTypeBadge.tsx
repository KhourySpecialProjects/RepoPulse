import { cn } from '@/lib/utils'
import type { CommitType } from '@/types'

const typeConfig: Record<CommitType, { label: string; pillClass: string; activeClass: string }> = {
  substantive: {
    label: 'Substantive',
    pillClass: 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100',
    activeClass: 'bg-emerald-600 text-white border-emerald-600',
  },
  logistical: {
    label: 'Logistical',
    pillClass: 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200',
    activeClass: 'bg-slate-600 text-white border-slate-600',
  },
}

// Deliberately outside the map: `typeConfig` stays keyed by exactly the valid
// vocabulary, so a null falls through here rather than silently picking a
// default verdict the model never gave.
const UNCLASSIFIED = {
  label: '—',
  pillClass: 'bg-gray-100 text-gray-400 border-gray-200',
  activeClass: 'bg-gray-500 text-white border-gray-500',
}

const BASE = 'inline-flex items-center rounded border px-1.5 py-0.5 text-xs font-medium transition-colors'

interface CommitTypeBadgeProps {
  type: CommitType | null
  /** Supply to make the badge a filter toggle; omit for static display. */
  onClick?: () => void
  selected?: boolean
  className?: string
}

export function CommitTypeBadge({
  type,
  onClick,
  selected = false,
  className,
}: CommitTypeBadgeProps) {
  const config = (type && typeConfig[type]) || UNCLASSIFIED
  const classes = cn(BASE, selected ? config.activeClass : config.pillClass, className)
  const title = type ? undefined : 'Not classified yet'

  if (!onClick) {
    return (
      <span className={classes} title={title}>
        {config.label}
      </span>
    )
  }

  return (
    <button
      type="button"
      aria-pressed={selected}
      title={title}
      onClick={(e) => {
        // Commit rows are themselves clickable (they expand a notes panel).
        e.stopPropagation()
        onClick()
      }}
      className={classes}
    >
      {config.label}
    </button>
  )
}
