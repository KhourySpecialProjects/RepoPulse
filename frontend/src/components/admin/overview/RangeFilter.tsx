export const RANGE_OPTIONS = [7, 30, 90] as const

/**
 * A compact window toggle, rendered inside the header of the one card it
 * scopes.
 *
 * It used to be a page-level filter row above a two-section layout. That was
 * right when several cards were windowed; it is wrong now that only LLM call
 * volume is. A control sitting above five cards and moving one of them makes
 * a promise the page cannot keep, and the reader has no way to tell which
 * numbers just changed.
 *
 * Labels are abbreviated to fit a card header, with the full phrase kept as
 * the accessible name so it still reads as "7 days" rather than "7 d".
 */
interface Props {
  days: number
  onChange: (days: number) => void
}

export function RangeFilter({ days, onChange }: Props) {
  return (
    <div className="flex items-center gap-1" data-testid="overview-range-filter">
      {RANGE_OPTIONS.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          aria-pressed={days === option}
          aria-label={`${option} days`}
          className={`rounded border px-1.5 py-0.5 text-xs transition-colors ${
            days === option
              ? 'border-indigo-200 bg-indigo-50 text-indigo-700'
              : 'border-border text-muted-foreground hover:bg-muted'
          }`}
        >
          {option}d
        </button>
      ))}
    </div>
  )
}
