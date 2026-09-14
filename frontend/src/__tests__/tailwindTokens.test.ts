/**
 * Every colour variable in index.css must be mapped into the Tailwind theme.
 *
 * `--popover` and `--card` were declared in index.css but never mapped in
 * tailwind.config.js. Tailwind only generates classes for colours in its
 * theme, so `bg-popover` produced no CSS rule whatsoever — the class was
 * simply absent. The select dropdown carried `bg-popover`, so it rendered with
 * no background at all and you could read the page straight through it.
 *
 * Nothing warns about this: a missing utility class is silent in both the
 * build and the browser, and the variable sitting in index.css makes it look
 * wired up. So assert the two halves agree.
 */
import { describe, it, expect } from 'vitest'
// Raw text rather than `fs`: keeps this a browser-environment test with no
// node typings, and the config is only ever inspected for `var(--x)` names.
import cssSource from '../index.css?raw'
import configSource from '../../tailwind.config.js?raw'

/** Not a colour — maps to borderRadius, not `colors`. */
const NON_COLOR_VARS = new Set(['radius'])

function declaredColorVars(): string[] {
  const names = new Set<string>()
  for (const match of cssSource.matchAll(/--([a-z-]+)\s*:/g)) {
    if (!NON_COLOR_VARS.has(match[1])) names.add(match[1])
  }
  return [...names]
}

/** The `var(--x)` names the Tailwind theme actually references. */
function mappedColorVars(): Set<string> {
  const found = new Set<string>()
  for (const match of configSource.matchAll(/var\(--([a-z-]+)\)/g)) {
    found.add(match[1])
  }
  return found
}

describe('tailwind colour tokens', () => {
  it('maps every colour variable declared in index.css', () => {
    const mapped = mappedColorVars()
    const missing = declaredColorVars().filter((name) => !mapped.has(name))

    expect(missing).toEqual([])
  })

  it('exposes popover and card, which dropdowns and cards paint with', () => {
    const mapped = mappedColorVars()

    expect(mapped.has('popover')).toBe(true)
    expect(mapped.has('popover-foreground')).toBe(true)
    expect(mapped.has('card')).toBe(true)
    expect(mapped.has('card-foreground')).toBe(true)
  })
})
