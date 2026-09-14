const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const

/**
 * Render a byte count for humans.
 *
 * The single place bytes become a string. API responses carry integers only,
 * so every surface formats the same way and a number can still be sorted or
 * summed before it is displayed.
 *
 * Binary units (1024), which is what browsers and `du` both mean. A trailing
 * ".0" is dropped so a round value reads "1 KB" rather than "1.0 KB".
 * Non-finite or negative input renders "0 B" rather than "NaN undefined".
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'

  let value = bytes
  let unitIndex = 0
  while (value >= 1024 && unitIndex < UNITS.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  // Bytes are whole; larger units get at most one decimal.
  const rounded = unitIndex === 0 ? Math.round(value) : parseFloat(value.toFixed(1))
  return `${rounded} ${UNITS[unitIndex]}`
}
