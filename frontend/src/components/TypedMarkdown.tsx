import { useEffect, useState } from 'react'
import { MarkdownContent } from '@/components/MarkdownContent'

/** Roughly how long a full summary takes to type in, regardless of length. */
const TARGET_DURATION_MS = 3200
const TICK_MS = 16

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
}

/**
 * Reveals markdown a few characters at a time, the way a model's reply streams
 * in. The summary is already complete by the time it reaches us — this only
 * paces the reveal, so `animate` should be true solely for a summary the user
 * just generated, never for one loaded from history.
 */
export function TypedMarkdown({
  content,
  animate,
  onDone,
}: {
  content: string
  animate: boolean
  onDone?: () => void
}) {
  const [shown, setShown] = useState(() => (animate ? '' : content))

  useEffect(() => {
    if (!animate || prefersReducedMotion()) {
      setShown(content)
      return
    }

    setShown('')
    // Longer summaries type faster per tick so the whole reveal lands in about
    // the same time either way.
    const perTick = Math.max(1, Math.ceil(content.length / (TARGET_DURATION_MS / TICK_MS)))
    let cursor = 0

    const timer = setInterval(() => {
      cursor += perTick
      if (cursor >= content.length) {
        setShown(content)
        clearInterval(timer)
        onDone?.()
        return
      }
      setShown(content.slice(0, cursor))
    }, TICK_MS)

    return () => clearInterval(timer)
    // onDone is intentionally excluded: it only fires once per reveal and a new
    // identity each render would restart the animation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, animate])

  const typing = shown.length < content.length

  return (
    <div className="relative">
      <MarkdownContent content={shown} />
      {typing && (
        <span
          aria-hidden
          className="ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 animate-pulse bg-orchid-500 align-text-bottom motion-reduce:hidden"
        />
      )}
    </div>
  )
}
