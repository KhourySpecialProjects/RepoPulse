/**
 * Where the Vite dev server forwards /api — read by vite.config.ts.
 *
 * The default, the `backend` Compose service, is right locally and on the main
 * deployment. A Coolify preview renames its services (`backend-pr-<n>`) yet
 * runs on the main deployment's network, where `backend` is the *main*
 * deployment's backend — so a preview set API_PROXY_TARGET to its own, e.g.
 * http://backend-pr-123:8000, in Coolify's preview environment variables.
 *
 * Not VITE_-prefixed on purpose: this is server-side config for the proxy, and
 * nothing in the browser bundle should see it. It lives under src/ only so the
 * main type-check and the test suite cover it; the app itself never imports it.
 */
export const DEFAULT_API_PROXY_TARGET = 'http://backend:8000'

export function apiProxyTarget(env: Record<string, string | undefined>): string {
  return env.API_PROXY_TARGET?.trim() || DEFAULT_API_PROXY_TARGET
}
