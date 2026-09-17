import { useEffect } from 'react'

/**
 * The landing page is a static document in `public/`, not a React page: it
 * carries its own stylesheet and frames the product tour in an iframe, so it
 * is served verbatim next to the app rather than rendered by it.
 *
 * `replace`, not `assign`: the visitor never chose to be at `/`, so it should
 * not sit in their history between the landing page and wherever they came
 * from. Going Back from the landing page leaves the app entirely, which is
 * what someone who arrived at a marketing page expects.
 */
export const LANDING_DOCUMENT = '/landing.html'

export function LandingPage() {
  useEffect(() => {
    window.location.replace(LANDING_DOCUMENT)
  }, [])

  // One frame of nothing, announced — a screen reader should not be left in
  // silence while the document is swapped underneath it.
  return (
    <p role="status" className="sr-only">
      Taking you to the RepoPulse landing page.
    </p>
  )
}
