import { motion } from 'framer-motion'
import { AlertTriangle, AlertCircle, Sparkles, Info } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Insight, InsightTone } from '@/lib/dashboardInsights'

const TONE: Record<InsightTone, { icon: string; Icon: typeof Info }> = {
  bad: { icon: 'text-red-600', Icon: AlertCircle },
  warn: { icon: 'text-amber-600', Icon: AlertTriangle },
  good: { icon: 'text-emerald-600', Icon: Sparkles },
  neutral: { icon: 'text-muted-foreground', Icon: Info },
}

const container = { hidden: {}, visible: { transition: { staggerChildren: 0.06 } } }
const item = { hidden: { opacity: 0, x: -6 }, visible: { opacity: 1, x: 0, transition: { duration: 0.2 } } }

/**
 * The findings the numbers add up to, in sentences.
 *
 * One card holding a list, not four tinted cards in a row: the tinted version
 * cost a full grid row and most of it was padding. The icon colour carries the
 * severity, which is all the tint was doing.
 */
export function WorkspaceInsights({
  insights,
  className,
}: {
  insights: Insight[]
  className?: string
}) {
  if (insights.length === 0) return null

  return (
    <motion.section
      aria-label="Workspace insights"
      variants={container}
      initial="hidden"
      animate="visible"
      className={cn(
        'flex flex-col min-h-56 rounded-2xl border border-brand-100 bg-gradient-to-br from-brand-50 via-white to-white p-4 shadow-sm xl:min-h-0',
        className
      )}
    >
      <h2 className="flex items-center gap-2 text-sm font-semibold"><Sparkles className="h-4 w-4 text-brand-500" />What stands out</h2>

      <ul className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto">
        {insights.map(insight => {
          const tone = TONE[insight.tone]
          return (
            <motion.li key={insight.id} variants={item} className="flex items-start gap-2 rounded-xl border border-white bg-white/80 p-2.5 text-xs shadow-sm">
              <tone.Icon className={cn('mt-0.5 h-3.5 w-3.5 flex-shrink-0', tone.icon)} />
              <span className="leading-relaxed">{insight.text}</span>
            </motion.li>
          )
        })}
      </ul>
    </motion.section>
  )
}
