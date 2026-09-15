/**
 * The purple-and-white identity, pinned.
 *
 * Two things are easy to lose and invisible when lost: the exact requested
 * shades drifting to whatever purple a later edit reached for, and a stray
 * `indigo-600` surviving a retheme in a rarely-visited page. Neither breaks a
 * build or a render, so nothing else would catch them.
 *
 * Reads source text rather than computed styles — JSDOM does not run Tailwind,
 * so the class names are the only thing there is to assert on.
 */
import { describe, it, expect } from 'vitest'
// Depends on `test.css: true` in vite.config.ts. With Vitest's default the CSS
// import is stubbed to '' and every assertion below silently passes, so the
// first test here checks the text arrived before trusting the rest.
import cssSource from '../index.css?raw'
import configSource from '../../tailwind.config.js?raw'

/**
 * Every hand-written source file. Tests are excluded: they legitimately name
 * old classes when documenting a migration, and `dist/` is build output.
 */
const sourceFiles: Record<string, string> = {
  ...import.meta.glob('../pages/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('../components/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('../lib/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('../hooks/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }),
}

/** Reads an `--x: <h> <s>% <l>%;` declaration out of index.css. */
function cssVar(name: string): { h: number; s: number; l: number } {
  const match = new RegExp(`--${name}:\\s*([\\d.]+)\\s+([\\d.]+)%\\s+([\\d.]+)%`).exec(cssSource)
  if (!match) throw new Error(`--${name} not declared in index.css`)
  return { h: Number(match[1]), s: Number(match[2]), l: Number(match[3]) }
}

describe('the requested shades are the palette', () => {
  it('reads the real stylesheet, not an empty stub', () => {
    expect(cssSource).toContain('--primary')
    expect(configSource).toContain('brand:')
  })

  // The four uploaded swatches, at the ramp stop matching each one's lightness.
  it.each([
    ['Violet #7F00FF', 'brand', '600', 'hsl(270, 100%, 50%)'],
    ['Mauve #E0B0FF', 'brand', '200', 'hsl(276, 100%, 85%)'],
    ['Bright Purple #BF40BF', 'orchid', '500', 'hsl(300, 50%, 50%)'],
    ['Periwinkle #CCCCFF', 'periwinkle', '200', 'hsl(240, 100%, 90%)'],
  ])('keeps %s as %s-%s', (_name, scale, stop, value) => {
    const block = new RegExp(`${scale}:\\s*\\{[^}]*\\}`).exec(configSource)?.[0]
    expect(block).toBeDefined()
    expect(block).toContain(`${stop}: "${value}"`)
  })

  it('drives primary, ring and accent from the violet hue', () => {
    // 243 was the old indigo. Anything in 265-305 reads as purple.
    for (const name of ['primary', 'ring', 'accent-foreground', 'secondary-foreground']) {
      const { h } = cssVar(name)
      expect(h, `--${name} hue`).toBeGreaterThanOrEqual(265)
      expect(h, `--${name} hue`).toBeLessThanOrEqual(305)
    }
  })

  it('gives Periwinkle a token that actually renders', () => {
    // Being present in tailwind.config.js is not enough: Tailwind only emits a
    // utility class that some file uses, so a shade nothing references compiles
    // to no CSS at all. Wiring it to --secondary puts it on real elements
    // (secondary badges and buttons).
    expect(cssVar('secondary')).toMatchObject({ h: 240, s: 100, l: 90 })
  })

  it('keeps white as the reading surface', () => {
    // Cards and popovers are pure white; the page is only barely tinted, so
    // a white card still separates from it.
    expect(cssVar('card')).toMatchObject({ s: 0, l: 100 })
    expect(cssVar('popover')).toMatchObject({ s: 0, l: 100 })
    expect(cssVar('background').l).toBeGreaterThanOrEqual(98)
  })
})

describe('semantic colour survives the retheme', () => {
  it('leaves destructive red', () => {
    const { h } = cssVar('destructive')
    expect(h === 0 || h >= 350).toBe(true)
  })

  it('leaves the health scale readable as green / amber / red', () => {
    expect(configSource).toContain('green: "hsl(142, 71%, 45%)"')
    expect(configSource).toContain('yellow: "hsl(38, 92%, 50%)"')
    expect(configSource).toContain('red: "hsl(0, 84%, 60%)"')
  })
})

describe('no pre-purple brand colour is left behind', () => {
  const LEGACY_BRAND =
    /\b(?:bg|text|border|ring|from|via|to|fill|stroke|divide|accent|outline|decoration|placeholder|shadow)-(?:indigo|violet|purple|fuchsia)-\d{2,3}\b/g

  it('uses no indigo, violet, purple or fuchsia utility class', () => {
    const offenders = Object.entries(sourceFiles).flatMap(([file, text]) =>
      [...text.matchAll(LEGACY_BRAND)].map((m) => `${file}: ${m[0]}`)
    )

    expect(offenders).toEqual([])
  })

  it('uses no indigo hex literal in charts or backgrounds', () => {
    // #6366f1 (indigo-500), #818cf8 (indigo-400) and #8b5cf6 / #a78bfa
    // (violet) were hand-written into Recharts props and the summary gradient,
    // where no class-name sweep would ever find them.
    const offenders = Object.entries(sourceFiles).flatMap(([file, text]) =>
      [...text.matchAll(/#(?:6366f1|818cf8|8b5cf6|a78bfa|4f46e5|4338ca)\b/gi)].map(
        (m) => `${file}: ${m[0]}`
      )
    )

    expect(offenders).toEqual([])
  })

  it('has no dark-mode block, because the app is light only', () => {
    expect(cssSource).not.toMatch(/\.dark\s*\{/)
    expect(cssSource).toContain('color-scheme: light')
  })
})
