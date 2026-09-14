import { useEffect, useState } from 'react'
import { useReducedMotion } from 'framer-motion'

const WORDS = [
  'Building', 'Coding', 'Splurging', 'Blurbing', 'Thinking', 'Connecting dots',
  'Analyzing', 'Synthesizing', 'Reasoning', 'Reviewing', 'Mapping', 'Parsing',
  'Exploring', 'Assembling', 'Polishing', 'Refining', 'Distilling', 'Drafting',
  'Evaluating', 'Organizing', 'Summarizing', 'Connecting', 'Compiling', 'Interpreting',
  'Shaping', 'Checking',
]

/** Decorative copy only; the button keeps a stable accessible loading label. */
export function ThinkingLabel() {
  const reducedMotion = useReducedMotion()
  const [text, setText] = useState('Generate Summary')

  useEffect(() => {
    if (reducedMotion) return
    let current = 'Generate Summary'
    let word = 0
    let deleting = true
    let timer: ReturnType<typeof setTimeout>

    function step() {
      if (deleting) {
        current = current.slice(0, -1)
        setText(current)
        if (current.length === 0) {
          deleting = false
          timer = setTimeout(step, 240)
        } else {
          timer = setTimeout(step, 35)
        }
      } else {
        const target = `${WORDS[word]}…`
        current = target.slice(0, current.length + 1)
        setText(current)
        if (current === target) {
          deleting = true
          word = (word + 1) % WORDS.length
          timer = setTimeout(step, 1400)
        } else {
          timer = setTimeout(step, 80)
        }
      }
    }

    timer = setTimeout(step, 200)
    return () => clearTimeout(timer)
  }, [reducedMotion])

  return (
    <span aria-hidden="true" className="inline-flex items-center text-violet-600">
      <span>{reducedMotion ? 'Generating…' : text}</span>
      <span className="summary-thinking-cursor ml-0.5 inline-block h-4 w-[2px] shrink-0 rounded-full bg-violet-500" />
    </span>
  )
}
