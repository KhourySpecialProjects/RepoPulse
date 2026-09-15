import { cn } from '@/lib/utils'
import type { HealthScore } from '@/types'

/** Each signal is scored 0–2 by the backend, so 2 is the top of the scale. */
const SIGNAL_MAX = 2

const TIERS = [
  { min: 0.7, label: 'Healthy', className: 'border-emerald-200 bg-emerald-50 text-emerald-700', dot: 'bg-emerald-500' },
  { min: 0.4, label: 'Needs attention', className: 'border-amber-200 bg-amber-50 text-amber-700', dot: 'bg-amber-500' },
  { min: -Infinity, label: 'At risk', className: 'border-red-200 bg-red-50 text-red-700', dot: 'bg-red-500' },
] as const

function tierFor(value: number) {
  const normalised = value / SIGNAL_MAX
  return TIERS.find(tier => normalised >= tier.min) ?? TIERS[TIERS.length - 1]
}

interface Signal {
  label: string
  value: number
  tip: string
}

function signalsFor(health: HealthScore): Signal[] {
  return [
    {
      label: 'Frequency',
      value: health.commit_fre
      quency,
      tip: 'Avg commits/week over the last 4 weeks. Green ≥10/wk, yellow 4–9/wk, red ≤3/wk.',
    },
    {
      label: 'Recency',
      value: health.recency,
      tip: 'Days since the most recent commit. Green <3 days, yellow 3–7 days, red >7 days.',
    },
    {
      label: 'Distribution',
      value: health.distribution,
      tip: 'How evenly commits are spread across contributors (Gini coefficient). Green = well distributed, red = one person dominates.',
    },
    {
      label: 'Branches',
      value: health.branch_activity,
      tip: 'Active branch count. Green ≥2 branches, yellow = 1 branch with recent activity, red = stale or no branches.',
    },
    {
      label: 'Msg Quality',
      value: health.commit_message_quality,
      tip: 'Percentage of commits with descriptive messages (≥10 chars, multi-word). Green <10% low-quality, red >30%.',
    },
    {
      // The only optional signal: a repo with no expected head count still gets
      // a pill, because "we cannot tell" is worth showing.
      label: 'Participation',
      value: health.participation ?? 0,
      tip: 'Actual vs expected unique contributors. Green = at or above expected, yellow ≥60%, red <60%.',
    },
  ]
}

/**
 * The five-plus health signals as a flat row of pills.
 *
 * These used to live behind a `Health details` disclosure in the page header,
 * which meant the numbers that explain the composite score were one click away
 * from the graph they explain. Laid out across the activity card instead, the
 * signals and the commit history read together.
 */
export function HealthSignalPills({
  health,
  className,
}: {
  health: HealthScore | null | undefined
  className?: string
}) {
  if (!health) return null

  return (
    <ul className={cn('flex flex-wrap items-center gap-1.5', className)}>
      {signalsFor(health).map(signal => {
        const tier = tierFor(signal.value)
        return (
          <li
            key={signal.label}
            title={signal.tip}
            className={cn(
              'flex cursor-default items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium',
              tier.className
            )}
          >
            <span className={cn('h-1.5 w-1.5 flex-shrink-0 rounded-full', tier.dot)} />
            <span>{signal.label}</span>
            {/* The tier drives the colour, so it also has to exist as text. */}
            <span className="sr-only">{tier.label}</span>
          </li>
        )
      })}
    </ul>
  )
}
