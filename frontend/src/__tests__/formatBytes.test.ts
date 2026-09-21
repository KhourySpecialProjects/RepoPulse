import { describe, expect, it } from 'vitest'

import { formatBytes, formatBytesUnbroken } from '@/lib/formatBytes'

describe('formatBytes', () => {
  it('renders zero without a unit surprise', () => {
    expect(formatBytes(0)).toBe('0 B')
  })

  it('leaves byte-scale values whole', () => {
    expect(formatBytes(1)).toBe('1 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1023)).toBe('1023 B')
  })

  it('switches to binary units at 1024', () => {
    expect(formatBytes(1024)).toBe('1 KB')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(1024 * 1024)).toBe('1 MB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5 MB')
    expect(formatBytes(1024 * 1024 * 1024)).toBe('1 GB')
  })

  it('drops a trailing .0 rather than printing "1.0 KB"', () => {
    expect(formatBytes(2048)).toBe('2 KB')
  })

  it('treats nonsense input as zero instead of rendering NaN', () => {
    expect(formatBytes(-5)).toBe('0 B')
    expect(formatBytes(Number.NaN)).toBe('0 B')
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe('0 B')
  })
})

describe('formatBytesUnbroken', () => {
  it('joins the number to its unit with a non-breaking space', () => {
    expect(formatBytesUnbroken(12 * 1024 * 1024)).toBe('12\u00a0MB')
    expect(formatBytesUnbroken(0)).toBe('0\u00a0B')
  })

  it('leaves no breaking space for a chart label to wrap on', () => {
    // Recharts splits label text on /[ \f\n\r\t\v\u2028\u2029]+/ and rewraps
    // it to a width it inherits from the mark. A label with no breaking
    // space is a single word, so it renders on one line whatever that
    // width turns out to be.
    expect(formatBytesUnbroken(1536)).not.toMatch(/[ \f\n\r\t\v\u2028\u2029]/)
  })

  it('otherwise reads exactly like formatBytes', () => {
    for (const bytes of [0, 1023, 1024, 1536, 5 * 1024 ** 3, Number.NaN]) {
      expect(formatBytesUnbroken(bytes)).toBe(formatBytes(bytes).replace(' ', '\u00a0'))
    }
  })
})
