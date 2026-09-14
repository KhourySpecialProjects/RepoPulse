import { useReducedMotion } from 'framer-motion'
import { cn } from '@/lib/utils'

/**
 * The mascot on an empty notifications feed.
 *
 * An animated WebP rather than a GIF: the source art is anti-aliased line
 * work, and GIF's 1-bit transparency would leave a hard white fringe on every
 * outline once the background was keyed out. WebP carries real 8-bit alpha, so
 * the edges stay clean on any background.
 *
 * CSS cannot pause an animated image, so reduced motion gets a still frame
 * rather than a loop that ignores the preference.
 */

const ANIMATED = '/empty-inbox-snowman.webp'
const STILL = '/empty-inbox-snowman-still.png'

export function EmptyInboxMascot({ className }: { className?: string }) {
  const reduceMotion = useReducedMotion()

  return (
    <img
      data-testid="empty-inbox-mascot"
      src={reduceMotion ? STILL : ANIMATED}
      alt="A snowman in sunglasses, relaxing with a cocktail"
      width={160}
      height={116}
      decoding="async"
      className={cn('h-auto w-40', className)}
    />
  )
}
