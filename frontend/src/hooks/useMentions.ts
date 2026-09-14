import { useState, type RefObject } from 'react'
import type { UserDetail } from '@/types'

/**
 * The @mention slug for a display name.
 *
 * Must stay in step with `slug_for_display_name` in
 * `backend/app/services/notification_service.py` — the backend matches the
 * text against `@` + this slug to decide who got mentioned, so a mismatch here
 * means the mention renders fine and silently notifies nobody.
 */
export function mentionSlug(displayName: string): string {
  return displayName.replace(/\s+/g, '_')
}

export interface MentionAutocomplete {
  /** The text typed after the `@`, or null when not mentioning. */
  search: string | null
  /** Up to five users matching `search`. */
  matches: UserDetail[]
  /** Call on every change of the text field. */
  handleChange: (value: string, cursor: number) => void
  /** Replace the partial `@…` token with a full mention. */
  insert: (user: UserDetail, value: string, cursor: number) => string
  /** Dismiss the popover, e.g. on Escape or blur. */
  cancel: () => void
}

/**
 * Shared @mention autocomplete state.
 *
 * Extracted from NoteForm so note bodies and comments behave identically —
 * the backend has always created mention notifications for comments, but the
 * comment box had no way to type one.
 */
export function useMentions(
  users: UserDetail[],
  fieldRef?: RefObject<HTMLTextAreaElement>
): MentionAutocomplete {
  const [search, setSearch] = useState<string | null>(null)

  const matches =
    search !== null
      ? users
          .filter((u) => u.display_name.toLowerCase().includes(search.toLowerCase()))
          .slice(0, 5)
      : []

  function handleChange(value: string, cursor: number) {
    const upToCursor = value.slice(0, cursor)
    const lastAt = upToCursor.lastIndexOf('@')
    if (lastAt !== -1) {
      const afterAt = upToCursor.slice(lastAt + 1)
      // A space or newline ends the token, so "@Mark said" stops suggesting.
      if (!afterAt.includes(' ') && !afterAt.includes('\n')) {
        setSearch(afterAt)
        return
      }
    }
    setSearch(null)
  }

  function insert(user: UserDetail, value: string, cursor: number): string {
    const upToCursor = value.slice(0, cursor)
    const lastAt = upToCursor.lastIndexOf('@')
    const next =
      value.slice(0, lastAt) + `@${mentionSlug(user.display_name)} ` + value.slice(cursor)
    setSearch(null)
    // Focus is restored after React has re-rendered with the new value.
    setTimeout(() => fieldRef?.current?.focus(), 0)
    return next
  }

  return { search, matches, handleChange, insert, cancel: () => setSearch(null) }
}
