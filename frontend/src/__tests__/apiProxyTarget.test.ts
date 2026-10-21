/**
 * Where the Vite dev server forwards /api.
 *
 * `backend` — the Compose service name — is right locally and on the main
 * deployment. It is wrong in a Coolify preview: the preview's services are
 * renamed (backend-pr-<n>) but share the main deployment's network, where
 * `backend` is the main deployment's backend. A preview's pages then ran
 * against the previous release's API, which is why its dashboard said
 * "Couldn't load Linear projects" for an endpoint only the PR had.
 */
import { describe, it, expect } from 'vitest'
import { apiProxyTarget, DEFAULT_API_PROXY_TARGET } from '@/lib/apiProxyTarget'

describe('apiProxyTarget', () => {
  it('defaults to the backend Compose service', () => {
    expect(DEFAULT_API_PROXY_TARGET).toBe('http://backend:8000')
    expect(apiProxyTarget({})).toBe('http://backend:8000')
  })

  it('uses API_PROXY_TARGET when it is set', () => {
    expect(apiProxyTarget({ API_PROXY_TARGET: 'http://backend-pr-123:8000' })).toBe('http://backend-pr-123:8000')
  })

  it('trims surrounding whitespace', () => {
    expect(apiProxyTarget({ API_PROXY_TARGET: '  http://backend-pr-7:8000 \n' })).toBe('http://backend-pr-7:8000')
  })

  it('falls back to the default for a blank value', () => {
    // An empty variable in a deploy UI means "not set", not "proxy to nowhere".
    expect(apiProxyTarget({ API_PROXY_TARGET: '' })).toBe(DEFAULT_API_PROXY_TARGET)
    expect(apiProxyTarget({ API_PROXY_TARGET: '   ' })).toBe(DEFAULT_API_PROXY_TARGET)
  })
})
