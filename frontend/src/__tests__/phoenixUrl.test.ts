import { describe, expect, it } from 'vitest'

import { LOCAL_PHOENIX_URL, resolvePhoenixUrl } from '@/lib/phoenixUrl'

describe('resolvePhoenixUrl', () => {
  it('falls back to the local Compose service when nothing is configured', () => {
    // The common case, and the one a developer gets for free: `docker compose
    // up` runs Phoenix alongside the app on 6006 and sets no override.
    expect(resolvePhoenixUrl(undefined)).toBe('http://localhost:6006')
    expect(LOCAL_PHOENIX_URL).toBe('http://localhost:6006')
  })

  it('uses the configured URL when the deployment sets one', () => {
    expect(
      resolvePhoenixUrl('https://phoenix.repopulse.cs4535.cloud/projects?timeRangeKey=7d'),
    ).toBe('https://phoenix.repopulse.cs4535.cloud/projects?timeRangeKey=7d')
  })

  it('treats an empty or blank value as unset', () => {
    // An `environment:` key declared with no value arrives as "", which must
    // not render an href of "" — that resolves to the current page and the
    // link would silently do nothing.
    expect(resolvePhoenixUrl('')).toBe(LOCAL_PHOENIX_URL)
    expect(resolvePhoenixUrl('   ')).toBe(LOCAL_PHOENIX_URL)
  })

  it('trims surrounding whitespace rather than baking it into the href', () => {
    expect(resolvePhoenixUrl('  https://phoenix.example/projects  ')).toBe(
      'https://phoenix.example/projects',
    )
  })
})
