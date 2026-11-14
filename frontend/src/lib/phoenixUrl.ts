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
 * Note this is NOT keyed off `import.meta.env.DEV`. Local development and
 * the deployment are both Vite builds of the same source; which one is
 * "production" says nothing about where Phoenix lives, so the address has to
 * be configured explicitly. The deployment passes it as the
 * `VITE_PHOENIX_URL` build arg in spirostest-docker-compose.yml.
 *
 * Blank is treated as unset. A build arg declared with no value
 * arrives as `""`, and an empty href resolves to the current page — a link
 * that looks live and goes nowhere.
 */
export function resolvePhoenixUrl(configured: string | undefined): string {
  const trimmed = configured?.trim()
  return trimmed ? trimmed : LOCAL_PHOENIX_URL
}

/** The resolved URL, read once from the environment Vite compiled in. */
export const PHOENIX_URL = resolvePhoenixUrl(import.meta.env.VITE_PHOENIX_URL)
