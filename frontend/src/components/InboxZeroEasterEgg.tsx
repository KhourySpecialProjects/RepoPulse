import { motion, useReducedMotion } from 'framer-motion'
import { GitBranch, Star } from 'lucide-react'

/**
 * Easter egg for a completely quiet notifications page: the RepoPulse mark
 * flying a rainbow trail. Original artwork — the trail is CSS gradients and the
 * flyer is the app's own logo icon, so nothing is fetched from the network and
 * the page still works offline.
 */

const TRAIL_COLOURS = [
  '#ef4444', // red
  '#f97316', // orange
  '#eab308', // yellow
  '#22c55e', // green
  '#3b82f6', // blue
  '#8b5cf6', // violet
]

// Fixed positions so the sparkle field does not reshuffle on every render.
const SPARKLES = [
  { top: '12%', left: '8%', size: 10, delay: 0 },
  { top: '68%', left: '18%', size: 8, delay: 0.4 },
  { top: '24%', left: '34%', size: 7, delay: 0.9 },
  { top: '78%', left: '52%', size: 9, delay: 0.2 },
  { top: '18%', left: '68%', size: 8, delay: 1.1 },
  { top: '62%', left: '82%', size: 10, delay: 0.6 },
  { top: '38%', left: '92%', size: 7, delay: 1.4 },
]

export function InboxZeroEasterEgg() {
  // Honour the OS "reduce motion" setting: still colourful, just still.
  const reduceMotion = useReducedMotion()

  return (
    <div
      data-testid="inbox-zero-easter-egg"
      role="img"
      aria-label="Inbox zero — nothing needs your attention"
      className="relative overflow-hidden py-14 px-6 bg-slate-900 select-none"
    >
      {/* Sparkle field */}
      {SPARKLES.map((sparkle, i) => (
        <motion.span
          key={i}
          aria-hidden="true"
          className="absolute text-white/70"
          style={{ top: sparkle.top, left: sparkle.left }}
          animate={reduceMotion ? undefined : { opacity: [0.15, 1, 0.15], scale: [0.8, 1.1, 0.8] }}
          transition={
            reduceMotion
              ? undefined
              : { duration: 2, repeat: Infinity, delay: sparkle.delay, ease: 'easeInOut' }
          }
        >
          <Star style={{ width: sparkle.size, height: sparkle.size }} fill="currentColor" />
        </motion.span>
      ))}

      <div className="relative flex items-center justify-center">
        {/* Rainbow trail streaming out behind the flyer */}
        <div className="flex flex-col justify-center" aria-hidden="true">
          {TRAIL_COLOURS.map((colour, i) => (
            <motion.span
              key={colour}
              data-testid="rainbow-stripe"
              className="block h-2 w-28 sm:w-44 rounded-l-sm"
              style={{ backgroundColor: colour }}
              animate={reduceMotion ? undefined : { scaleX: [0.86, 1, 0.86] }}
              transition={
                reduceMotion
                  ? undefined
                  : {
                      duration: 0.6,
                      repeat: Infinity,
                      ease: 'easeInOut',
                      delay: i * 0.05,
                    }
              }
              // Grow from the trailing edge so the stripes ripple like a flag
              transformTemplate={({ scaleX }) => `scaleX(${scaleX ?? 1})`}
            />
          ))}
        </div>

        {/* The flyer: the app's own mark, bobbing along */}
        <motion.div
          data-testid="inbox-zero-flyer"
          aria-hidden="true"
          className="-ml-1 flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-500 shadow-lg ring-4 ring-indigo-300/40"
          animate={reduceMotion ? undefined : { y: [-6, 6, -6], rotate: [-4, 4, -4] }}
          transition={
            reduceMotion
              ? undefined
              : { duration: 1.1, repeat: Infinity, ease: 'easeInOut' }
          }
        >
          <GitBranch className="h-7 w-7 text-white" />
        </motion.div>
      </div>

      <div className="relative mt-8 text-center">
        <p className="text-sm font-semibold text-white">Inbox zero</p>
        <p className="mt-1 text-xs text-slate-400">
          No mentions, no replies, no reminders due. Go enjoy your day.
        </p>
      </div>
    </div>
  )
}
