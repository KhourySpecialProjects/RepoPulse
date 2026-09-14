import { motion, useReducedMotion } from 'framer-motion'
import { cn } from '@/lib/utils'

/**
 * A small pixel-art nyan cat, drawn inline so it works offline like the rest
 * of the app. Used as the empty-state mascot on the notifications feed.
 */

const RAINBOW_COLORS = ['#ff0000', '#ff9900', '#ffff00', '#33ff00', '#0099ff', '#6633ff']

/** Rainbow trail is chopped into blocks so it can wiggle as a square wave. */
const TRAIL_BLOCKS = [0, 1, 2, 3, 4, 5, 6, 7]
const BLOCK_WIDTH = 8
const STRIPE_HEIGHT = 4
const TRAIL_TOP = 8

const STARS = [
  { delay: 0, y: 4, scale: 1 },
  { delay: 0.9, y: 30, scale: 0.75 },
  { delay: 1.8, y: 17, scale: 0.6 },
  { delay: 2.6, y: 26, scale: 0.9 },
]

/** Two-frame step, so the motion reads as pixel art rather than a smooth glide. */
const STEP_KEYFRAMES = { times: [0, 0.499, 0.5, 1], duration: 0.4, repeat: Infinity, ease: 'linear' as const }

export function NyanCat({ className }: { className?: string }) {
  const reduceMotion = useReducedMotion()

  return (
    <svg
      data-testid="nyan-cat"
      role="img"
      aria-label="Nyan cat flying past an empty inbox"
      viewBox="0 0 120 40"
      shapeRendering="crispEdges"
      className={cn('h-10 w-[7.5rem]', className)}
    >
      {/* Twinkling background stars */}
      {!reduceMotion &&
        STARS.map((star, i) => (
          <motion.g
            key={i}
            initial={{ x: 120, opacity: 0 }}
            animate={{ x: -10, opacity: [0, 1, 1, 0] }}
            transition={{ duration: 3, delay: star.delay, repeat: Infinity, ease: 'linear' }}
          >
            <g transform={`translate(0 ${star.y}) scale(${star.scale})`}>
              <rect x="2" y="0" width="2" height="6" fill="#cbd5e1" />
              <rect x="0" y="2" width="6" height="2" fill="#cbd5e1" />
            </g>
          </motion.g>
        ))}

      {/* Rainbow trail */}
      {TRAIL_BLOCKS.map((block) => {
        const offset = block % 2 === 0 ? [0, 0, 3, 3] : [3, 3, 0, 0]
        return (
          <motion.g
            key={block}
            animate={reduceMotion ? undefined : { y: offset }}
            transition={STEP_KEYFRAMES}
          >
            {RAINBOW_COLORS.map((color, stripe) => (
              <rect
                key={color}
                x={block * BLOCK_WIDTH}
                y={TRAIL_TOP + stripe * STRIPE_HEIGHT}
                width={BLOCK_WIDTH}
                height={STRIPE_HEIGHT}
                fill={color}
              />
            ))}
          </motion.g>
        )
      })}

      {/* The cat itself, bobbing in step with the trail */}
      <motion.g
        animate={reduceMotion ? undefined : { y: [0, 0, 3, 3] }}
        transition={STEP_KEYFRAMES}
      >
        {/* Tail */}
        <rect x="49" y="18" width="15" height="4" fill="#999999" />
        <rect x="49" y="17" width="15" height="1" fill="#000000" />
        <rect x="49" y="22" width="15" height="1" fill="#000000" />
        <rect x="48" y="17" width="1" height="6" fill="#000000" />

        {/* Legs */}
        {[66, 74, 83, 90].map((x) => (
          <g key={x}>
            <rect x={x} y="28" width="6" height="5" fill="#000000" />
            <rect x={x + 1} y="28" width="4" height="4" fill="#999999" />
          </g>
        ))}

        {/* Pop-tart body */}
        <rect x="62" y="9" width="36" height="21" fill="#000000" />
        <rect x="63" y="10" width="34" height="19" fill="#ffcc99" />
        <rect x="66" y="13" width="28" height="13" fill="#ff99ff" />
        {[
          [69, 16],
          [76, 22],
          [83, 15],
          [89, 21],
          [79, 17],
        ].map(([x, y]) => (
          <rect key={`${x}-${y}`} x={x} y={y} width="2" height="2" fill="#ff3399" />
        ))}

        {/* Head */}
        <path d="M96 12 L96 6 L102 12 Z" fill="#999999" stroke="#000000" strokeWidth="1" />
        <path d="M112 12 L112 6 L106 12 Z" fill="#999999" stroke="#000000" strokeWidth="1" />
        <rect x="95" y="11" width="18" height="17" fill="#000000" />
        <rect x="96" y="12" width="16" height="15" fill="#999999" />

        {/* Face */}
        <rect x="99" y="16" width="2" height="3" fill="#000000" />
        <rect x="107" y="16" width="2" height="3" fill="#000000" />
        <rect x="97" y="20" width="3" height="2" fill="#ff9999" />
        <rect x="108" y="20" width="3" height="2" fill="#ff9999" />
        <rect x="102" y="21" width="4" height="1" fill="#000000" />
        <rect x="101" y="22" width="1" height="1" fill="#000000" />
        <rect x="106" y="22" width="1" height="1" fill="#000000" />
      </motion.g>
    </svg>
  )
}
