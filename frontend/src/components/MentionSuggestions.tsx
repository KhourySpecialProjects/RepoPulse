import type { UserDetail } from '@/types'

interface MentionSuggestionsProps {
  users: UserDetail[]
  onSelect: (user: UserDetail) => void
}

/**
 * The @mention autocomplete popover.
 *
 * `onMouseDown` with `preventDefault` rather than `onClick`: a click would
 * blur the textarea first, and the blur handler closes this list before the
 * click ever lands.
 */
export function MentionSuggestions({ users, onSelect }: MentionSuggestionsProps) {
  if (users.length === 0) return null

  return (
    <div
      role="listbox"
      aria-label="Mention suggestions"
      className="absolute bottom-full left-0 z-50 mb-1 min-w-[180px] overflow-hidden rounded-lg border border-border bg-white shadow-lg"
    >
      {users.map((user) => (
        <button
          key={user.id}
          type="button"
          role="option"
          aria-selected={false}
          onMouseDown={(e) => {
            e.preventDefault()
            onSelect(user)
          }}
          className="w-full px-3 py-1.5 text-left text-sm transition-colors hover:bg-indigo-50 hover:text-indigo-700"
        >
          @{user.display_name}
        </button>
      ))}
    </div>
  )
}
