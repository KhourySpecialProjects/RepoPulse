import * as React from 'react'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface CheckboxProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange'> {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}

/**
 * A checkbox.
 *
 * Wraps a real `<input type="checkbox">` kept visually hidden but present in
 * the accessibility tree and the tab order, with the tick drawn over it. That
 * keeps label association, `getByRole('checkbox')` and form semantics working
 * for free, which a div-based control would have to reimplement.
 */
const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ checked, onCheckedChange, className, disabled, ...props }, ref) => (
    <span className={cn('relative inline-flex h-4 w-4 flex-shrink-0', className)}>
      <input
        ref={ref}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onCheckedChange(event.target.checked)}
        className="peer h-4 w-4 cursor-pointer appearance-none rounded border border-input bg-background transition-colors checked:border-indigo-600 checked:bg-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        {...props}
      />
      <Check
        aria-hidden="true"
        className="pointer-events-none absolute left-0 top-0 h-4 w-4 scale-75 text-white opacity-0 transition-opacity peer-checked:opacity-100"
      />
    </span>
  )
)
Checkbox.displayName = 'Checkbox'

export { Checkbox }
