import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import type { HealthStatus } from '@/types'

interface HealthBadgeProps {
  status: HealthStatus
  className?: string
}

/**
 * The words for each status, shared so charts and legends elsewhere read the
 * same as the badge rather than inventing their own synonyms.
 */
export const HEALTH_STATUS_LABELS: Record<HealthStatus, string> = {
  green: 'Healthy',
  yellow: 'At Risk',
  red: 'Critical',
  unknown: 'Unknown',
}

/** Status order from best to worst, for legends and stacked charts. */
export const HEALTH_STATUS_ORDER: readonly HealthStatus[] = ['green', 'yellow', 'red', 'unknown']

const statusConfig: Record<HealthStatus, { label: string; dotClass: string; pillClass: string }> = {
  green: {
    label: HEALTH_STATUS_LABELS.green,
    dotClass: 'bg-emerald-500',
    pillClass: 'bg-emerald-100 text-emerald-700 border border-emerald-200',
  },
  yellow: {
    label: HEALTH_STATUS_LABELS.yellow,
    dotClass: 'bg-amber-500',
    pillClass: 'bg-amber-100 text-amber-700 border border-amber-200',
  },
  red: {
    label: HEALTH_STATUS_LABELS.red,
    dotClass: 'bg-red-500',
    pillClass: 'bg-red-100 text-red-700 border border-red-200',
  },
  unknown: {
    label: HEALTH_STATUS_LABELS.unknown,
    dotClass: 'bg-gray-400',
    pillClass: 'bg-gray-100 text-gray-500 border border-gray-200',
  },
}

export function HealthBadge({ status, className }: HealthBadgeProps) {
  const config = statusConfig[status]

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold',
        config.pillClass,
        className
      )}
    >
      {status === 'red' ? (
        <motion.span
          className={cn('h-2 w-2 rounded-full', config.dotClass)}
          animate={{ opacity: [1, 0.3, 1] }}
          transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
        />
      ) : (
        <span className={cn('h-2 w-2 rounded-full', config.dotClass)} />
      )}
      {config.label}
    </span>
  )
}
