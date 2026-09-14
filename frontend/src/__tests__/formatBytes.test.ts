import { describe, expect, it } from 'vitest'

import { formatBytes } from '@/lib/formatBytes'

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
