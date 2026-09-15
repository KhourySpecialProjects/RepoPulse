import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  Tooltip,
} from 'recharts'
import { averageHealthSignals, SIGNAL_SCORE_MAX } from '@/lib/dashboardInsights'
import { cn } from '@/lib/utils'
import type { Repo } from '@/types'

/** The shape Recharts hands a custom tooltip, narrowed to what is used. */
interface SignalTooltipProps {
  active?: boolean
  payload?: Array<{ value?: number | string; payload?: { label?: string } }>
}

/**
 * The radar's hover label.
 *
 * Extracted from an inline `content` render prop so the scale it prints can be
 * asserted. It sat beside a `formatter` prop that Recharts silently ignores
 * whenever `content` is set, which let the two disagree.
 */
export function SignalTooltip({ active, payload }: SignalTooltipProps) {
  const point = payload?.[0]
  if (!active || !point) return null

  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
      {point.payload?.label}: {point.value}/{SIGNAL_SCORE_MAX}
    </div>
  )
}

/**
 * The cohort's average shape across the six health signals.
 *
 * A composite score says a repo is at risk; this says *why* the workspace is —
 * a radar that is round everywhere but one spike names the thing to teach.
 */
export function HealthSignalRadar({ repos, className, loading, failed }: { repos: Repo[]; className?: string; loading?: boolean; failed?: boolean }) {
  const signals = averageHealthSignals(repos)
  const weakest = [...signals].sort((a, b) => a.value - b.value)[0]

  return (
    <section
      aria-label="Health signal averages"
      className={cn(
        'flex min-h-64 min-w-0 flex-col rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm xl:min-h-0',
        className
      )}
    >
      <h2 className="text-sm font-semibold">Signal balance</h2>
      {/* The backend grades each signal 0, 1 or 2 internally. That is converted
          to a score out of 100 so it reads like the composite health badge
          rather than needing its own scale explained. */}
      <p className="text-[11px] text-slate-500">Each signal scored out of 100, averaged across repos</p>

      <div className="mt-1 min-h-40 flex-1 xl:min-h-0">
        {loading || failed || signals.length === 0 ? (
          <p className="flex h-full items-center justify-center text-center text-sm text-muted-foreground">
            {loading ? 'Loading health signals…' : failed ? 'Health signals are unavailable.' : 'No repository has been scored yet.'}
          </p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart data={signals} outerRadius="58%">
              <PolarGrid stroke="#e5e7eb" />
              <PolarAngleAxis dataKey="label" tick={{ fontSize: 9, fill: '#6b7280' }} />
              <PolarRadiusAxis domain={[0, SIGNAL_SCORE_MAX]} tick={false} axisLine={false} />
              <Tooltip content={<SignalTooltip />} />
              <Radar
                dataKey="value"
                stroke="#4f46e5"
                strokeWidth={2}
                fill="#6366f1"
                fillOpacity={0.25}
              />
            </RadarChart>
          </ResponsiveContainer>
        )}
      </div>

      {!loading && !failed && weakest && (
        <p className="mt-2 rounded-lg bg-indigo-50/60 px-2 py-2 text-[11px] text-slate-500">
          Weakest signal:{' '}
          <span className="font-medium text-foreground">{weakest.label}</span> at{' '}
          {weakest.value}/{SIGNAL_SCORE_MAX}.
        </p>
      )}
    </section>
  )
}
