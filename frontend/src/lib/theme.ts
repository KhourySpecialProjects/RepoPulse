/**
 * Brand colours as hex, for the places a Tailwind class cannot reach.
 *
 * Recharts takes `stroke` / `fill` / `style.fill` as raw values, and SVG
 * gradients need literals too. Those spots are invisible to a class-name
 * sweep, so a retheme silently leaves them on the old palette unless they read
 * from here. Everything that *can* use a class should use `brand-*` instead.
 *
 * Kept in step with the `brand` / `orchid` scales in tailwind.config.js.
 */
export const BRAND = {
  /** #7F00FF — brand-600. Primary series, strokes, emphasis. */
  violet: '#7F00FF',
  /** #BF40BF — orchid-500. Secondary series and generative-AI accents. */
  orchid: '#BF40BF',
  /** #E0B0FF — brand-200. Tints and gradient tails. */
  mauve: '#E0B0FF',
  /** #CCCCFF — periwinkle-200. Soft fills and gridlines. */
  periwinkle: '#CCCCFF',
} as const
