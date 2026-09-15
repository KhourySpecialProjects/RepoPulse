import { useLocation, useNavigate } from 'react-router-dom'

/**
 * Where a page's back arrow should send the reader, and what to call it.
 *
 * A repo can be opened from the dashboard, a collection, the sidebar or a
 * notification, so no single hard-coded parent is right. Pages that link
 * somewhere record their own location with `useBackState()`; the destination
 * reads it back here and only falls back to its structural parent when there
 * is nothing recorded — a fresh tab, a pasted URL, a reload.
 */
export interface BackTarget {
  to: string
  label: string
  goBack: () => void
}

/** Longest-first, so `/collections/:id` is not swallowed by `/collections`. */
const PAGE_NAMES: ReadonlyArray<readonly [RegExp, string]> = [
  [/^\/$/, 'dashboard'],
  [/^\/collections\/[^/?#]+/, 'collection'],
  [/^\/collections\/?(?:[?#]|$)/, 'collections'],
  [/^\/repos\/[^/?#]+/, 'repository'],
  [/^\/notifications/, 'notifications'],
  [/^\/settings/, 'settings'],
  [/^\/profile/, 'profile'],
  [/^\/admin/, 'admin'],
]

export function backLabelFor(path: string): string {
  const name = PAGE_NAMES.find(([pattern]) => pattern.test(path))?.[1]
  return name ? `Back to ${name}` : 'Go back'
}

/**
 * A path is only trusted as an origin if it stays inside the app. A
 * protocol-relative URL such as `//example.com` also starts with a slash, so
 * the second character has to be checked too.
 */
function isInAppPath(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//')
}

/** Reads the origin recorded by whoever linked here. */
export function useBackTarget(fallbackTo: string): BackTarget {
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: unknown } | null)?.from
  const to = isInAppPath(from) ? from : fallbackTo

  return { to, label: backLabelFor(to), goBack: () => navigate(to) }
}

/**
 * The router state to attach when linking somewhere with a back arrow. Spread
 * into a `<Link state={…}>` or pass as `navigate(path, { state })`.
 *
 * The search string rides along so returning to a filtered list restores the
 * filters rather than resetting them.
 */
export function useBackState(): { from: string } {
  const location = useLocation()
  return { from: `${location.pathname}${location.search}` }
}
