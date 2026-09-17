/**
 * Chart colour and formatting tokens.
 *
 * Every value here was produced by a palette validator, not picked by eye.
 * The checks that matter and the results they returned against this app's
 * white card surface (#ffffff):
 *
 *   CATEGORICAL (2 slots) - lightness band, chroma floor, CVD separation,
 *   normal-vision floor and surface contrast all PASS. Worst pair dE 24.7
 *   under protanopia/deuteranopia simulation, 33.6 unsimulated.
 *
 *   ORDINAL (5 steps) - monotone lightness, every adjacent step dL >= 0.06,
 *   light end 2.11:1 against the surface. PASS.
 *
 * Two rules the numbers imply, which the components enforce:
 *
 *   1. Status `warning` (1.83:1) and `serious` (2.64:1) sit below 3:1 on
 *      white *by design*. A status colour therefore never carries meaning
 *      alone - it always ships with an icon and a text label.
 *   2. Slot order is the CVD-safety mechanism, not decoration. Assign slots
 *      in sequence and never cycle: a generated third hue is indistinguishable
 *      from an existing one under simulation. Past the documented slots, fold
 *      the tail into "Other" or facet into small multiples.
 *
 * The app is light-mode only - index.css sets `color-scheme: light` and
 * declares no `.dark` block - so there is deliberately no dark column here.
 * Adding one means re-running the validator against the dark surface; the
 * dark steps are a selected set, never an automatic flip of these.
 */

/** Identity. Assign in order, never cycled. */
export const SERIES = ['#2a78d6', '#eb6834'] as const

/**
 * Position in an ordered sequence (age buckets, tiers).
 *
 * Ordinal rather than categorical: swapping "under a day" with "over 30 days"
 * would change the meaning, so the reader should see the order in the colour.
 */
export const ORDINAL = [
  '#86b6ef',
  '#5598e7',
  '#2a78d6',
  '#1c5cab',
  '#0d366b',
] as const

/**
 * State. Reserved meaning - never reused as "series 3".
 *
 * Steps are deliberately distinct from the categorical slots so a status
 * colour cannot impersonate a series.
 */
export const STATUS = {
  good: '#0ca30c',
  warning: '#fab219',
  serious: '#ec835a',
  critical: '#d03b3b',
} as const

/** Chart furniture. Recessive by construction. */
export const CHROME = {
  grid: '#e1e0d9',
  axis: '#c3c2b7',
  /** Axis ticks and labels. Text never wears a series colour. */
  label: '#898781',
  surface: '#ffffff',
  /** Out-of-scale marks: "never", "unknown", "other". */
  deemphasis: '#c3c2b7',
} as const

/** Mark geometry, fixed across every chart so they read as one system. */
export const MARKS = {
  /** Cap bar thickness - never fill the band; the leftover is air. */
  barSize: 18,
  /** Rounded data-end, square at the baseline. */
  barRadius: 4,
  strokeWidth: 2,
  /** A wash, never a saturated block. */
  areaOpacity: 0.1,
  dotRadius: 4,
  /** Keeps a mark legible where it overlaps another. */
  surfaceRing: 2,
} as const

/** Axis tick styling, applied as a Recharts `tick` prop. */
export const TICK = { fontSize: 11, fill: CHROME.label } as const

/**
 * Pick the ordinal step for position `index` of `count` ordered buckets.
 *
 * Clamps rather than cycles. Six buckets against five validated steps reuses
 * the darkest end, which reads as "at least this much" - whereas generating a
 * sixth step would leave the ramp unvalidated.
 */
export function ordinalStep(index: number, count: number): string {
  if (count <= 1) return ORDINAL[ORDINAL.length - 1]
  const scaled = Math.round((index / (count - 1)) * (ORDINAL.length - 1))
  return ORDINAL[Math.min(Math.max(scaled, 0), ORDINAL.length - 1)]
}

/**
 * Severity for a fraction-of-capacity meter.
 *
 * One set of thresholds for every meter, so the same disk cannot read as
 * healthy in one place and critical in another.
 */
export function capacitySeverity(
  percentUsed: number,
): keyof typeof STATUS | 'ok' {
  if (percentUsed >= 90) return 'critical'
  if (percentUsed >= 75) return 'warning'
  return 'ok'
}
