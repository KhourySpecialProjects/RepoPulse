/** Phoenix as `docker compose up` exposes it: the sibling service on 6006. */
export const LOCAL_PHOENIX_URL = 'http://localhost:6006'

/**
 * Where the "Phoenix" link points, given the configured override.
 *
 * Phoenix is deployed per environment, so its address is the one thing about
 * this link that cannot be hardcoded. Locally it is the Compose service on
 * 6006; on a deployment it is a hostname only that deployment knows. A single
 * literal is wrong in one of the two places, and it was wrong in the worse
 * one: `http://localhost:6006` served to a browser resolves against whoever
 * opened the page, so the deployed link dead-ended on the reader's own
 * machine. Same failure as pointing "Open in VS Code" at a container path.
 *
 * Note this is NOT keyed off `import.meta.env.DEV`. The deployment builds the
 * same frontend Dockerfile, which runs `npm run dev` — a Vite dev server —
 * so `DEV` is true there too and a mode check would quietly resolve to
 * localhost in production. `NODE_ENV=production` in the deploy compose does
 * not change that; only `vite build` does. The override has to be explicit.
 *
 * Blank is treated as unset. An `environment:` key declared with no value
 * arrives as `""`, and an empty href resolves to the current page — a link
 * that looks live and goes nowhere.
 */
export function resolvePhoenixUrl(configured: string | undefined): string {
  const trimmed = configured?.trim()
  return trimmed ? trimmed : LOCAL_PHOENIX_URL
}

/** The resolved URL, read once from the environment Vite compiled in. */
export const PHOENIX_URL = resolvePhoenixUrl(import.meta.env.VITE_PHOENIX_URL)
