import { motion } from 'framer-motion'
import { Line, LineChart, ResponsiveContainer } from 'recharts'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { CommitActivityPoint } from '@/types'

export type TileAccent = 'indigo' | 'emerald' | 'amber' | 'violet'

const ACCENT: Record<TileAccent, { ring: string; icon: string; stroke: string }> = {
  indigo: { ring: 'hover:border-indigo-200', icon: 'bg-indigo-50 text-indigo-600', stroke: '#6366f1' },
  emerald: { ring: 'hover:border-emerald-200', icon: 'bg-emerald-50 text-emerald-600', stroke: '#10b981' },
  amber: { ring: 'hover:border-amber-200', icon: 'bg-amber-50 text-amber-600', stroke: '#f59e0b' },
  violet: { ring: 'hover:border-violet-200', icon: 'bg-violet-50 text-violet-600', stroke: '#8b5cf6' },
}

/** Workspace totals with a real activity sparkline when a history exists. */
export function MetricTile({
  label,
  value,
  detail,
  icon: Icon,
  accent,
  sparkline,
  loading = false,
}: {
  label: string
  value: number | string
  detail?: string
  icon: LucideIcon
  accent: TileAccent
  sparkline?: CommitActivityPoint[]
  loading?: boolean
}) {
  const tone = ACCENT[accent]

  return (
    <motion.div
      variants={{ hidden: { opacity: 0, y: 8 }, visible: { opacity: 1, y: 0 } }}
      className={cn(
        'flex items-center gap-3 relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white px-4 py-4 shadow-sm',
        'transition-[box-shadow,border-color] duration-200 hover:shadow-md',
        tone.ring
      )}
    >
      <span className={cn('flex-shrink-0 rounded-xl p-2.5', tone.icon)}>
        <Icon className="h-4 w-4" />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-col items-start gap-1.5">
          {loading ? (
            <span aria-label="Loading metric" className="my-1 h-6 w-10 animate-pulse rounded bg-neutral-100" />
          ) : (
            <span className="text-3xl font-semibold leading-none tracking-tight tabular-nums">
              {value}
            </span>
          )}
          <span className="truncate text-[11px] font-medium text-slate-500">{label}</span>
        </div>
        {detail && <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{detail}</p>}
      </div>

      {sparkline && sparkline.length > 1 && !loading && (
        <div aria-hidden className="h-10 w-16 flex-shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={sparkline}>
              <Line type="monotone" dataKey="count" stroke={tone.stroke} strokeWidth={1.75} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </motion.div>
  )
}
