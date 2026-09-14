import * as React from 'react'
import { cn } from '@/lib/utils'

export interface SwitchProps {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  /** Accessible name. Required — a bare toggle tells a screen reader nothing. */
  'aria-label': string
  id?: string
  className?: string
}

/**
 * A toggle switch.
 *
 * Built on a native `role="switch"` button rather than a Radix primitive,
 * because `@radix-ui/react-switch` is not a dependency of this project and one
 * toggle is not worth adding one. `aria-checked` is what assistive tech and
 * `getByRole('switch', { checked })` both read.
 */
const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
  ({ checked, onCheckedChange, disabled = false, id, className, ...props }, ref) => (
    <button
      ref={ref}
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={props['aria-label']}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-indigo-600' : 'bg-input',
        className
      )}
    >
      <span
        className={cn(
          'inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform',
          checked ? 'translate-x-[1.15rem]' : 'translate-x-[0.15rem]'
        )}
      />
    </button>
  )
)
Switch.displayName = 'Switch'

export { Switch }
