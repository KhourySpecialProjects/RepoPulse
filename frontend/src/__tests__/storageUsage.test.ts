/**
 * Measuring what RepoPulse stores in this browser's localStorage.
 *
 * src/test/setup.ts does NOT clear localStorage between tests, so this file
 * clears it itself. Do not assume a clean slate.
 */

import { beforeEach, describe, expect, it } from 'vitest'

import {
  LOCAL_STORAGE_QUOTA_BYTES,
  measureLocalStorage,
} from '@/lib/storageUsage'

/** What a browser charges against quota: UTF-16 code units for key and value. */
const bytesFor = (key: string, value: string) => (key.length + value.length) * 2

beforeEach(() => {
  localStorage.clear()
})

describe('measureLocalStorage', () => {
  it('reports zero for an empty store', () => {
    const result = measureLocalStorage()

    expect(result.totalBytes).toBe(0)
    expect(result.entries).toEqual([])
    expect(result.percentOfQuota).toBe(0)
  })

  it('charges key and value as UTF-16 code units', () => {
    localStorage.setItem('auth_token', 'abc')

    const result = measureLocalStorage()

    expect(result.totalBytes).toBe(bytesFor('auth_token', 'abc'))
    expect(result.entries[0]?.bytes).toBe(bytesFor('auth_token', 'abc'))
  })

  it('sums across every key', () => {
    localStorage.setItem('auth_token', 'abc')
    localStorage.setItem('sidebar_width', '240')

    expect(measureLocalStorage().totalBytes).toBe(
      bytesFor('auth_token', 'abc') + bytesFor('sidebar_width', '240'),
    )
  })

  it('sorts entries largest first', () => {
    localStorage.setItem('sidebar_width', '1')
    localStorage.setItem('auth_user', JSON.stringify({ padding: 'x'.repeat(200) }))

    const keys = measureLocalStorage().entries.map((entry) => entry.key)

    expect(keys[0]).toBe('auth_user')
  })

  it('classifies auth, UI-preference and unknown keys', () => {
    localStorage.setItem('auth_token', 'a')
    localStorage.setItem('auth_user', '{}')
    localStorage.setItem('sidebar_collapsed', 'true')
    localStorage.setItem('sidebar_width', '240')
    localStorage.setItem('sidebar_expanded_collections', '[]')
    localStorage.setItem('something_else_entirely', 'x')

    const byKey = Object.fromEntries(
      measureLocalStorage().entries.map((entry) => [entry.key, entry.category]),
    )

    expect(byKey.auth_token).toBe('auth')
    expect(byKey.auth_user).toBe('auth')
    expect(byKey.sidebar_collapsed).toBe('ui-pref')
    expect(byKey.sidebar_width).toBe('ui-pref')
    expect(byKey.sidebar_expanded_collections).toBe('ui-pref')
    expect(byKey.something_else_entirely).toBe('other')
  })

  it('recognises all three per-repo key families and extracts the repo id', () => {
    localStorage.setItem('notes-drawer-pinned-repo-1', 'true')
    localStorage.setItem('repo-pull-requests-expanded-repo-2', 'true')
    localStorage.setItem('repo-checkins-repo-3', '[]')

    const entries = measureLocalStorage().entries
    const perRepo = entries.filter((entry) => entry.category === 'per-repo')

    expect(perRepo).toHaveLength(3)
    expect(perRepo.map((entry) => entry.repoId).sort()).toEqual([
      'repo-1',
      'repo-2',
      'repo-3',
    ])
  })

  it('totals the per-repo keys separately, because those are the ones that leak', () => {
    localStorage.setItem('auth_token', 'a')
    localStorage.setItem('repo-checkins-r1', '[1,2,3]')
    localStorage.setItem('notes-drawer-pinned-r2', 'true')

    const result = measureLocalStorage()

    expect(result.perRepo.keyCount).toBe(2)
    expect(result.perRepo.bytes).toBe(
      bytesFor('repo-checkins-r1', '[1,2,3]') +
        bytesFor('notes-drawer-pinned-r2', 'true'),
    )
  })

  it('reports orphan status as unknown when no repo list is supplied', () => {
    localStorage.setItem('repo-checkins-r1', '[]')

    const result = measureLocalStorage()

    expect(result.orphaned).toBeNull()
    expect(result.entries[0]?.orphaned).toBeNull()
  })

  it('flags per-repo keys whose repo no longer exists', () => {
    localStorage.setItem('repo-checkins-alive', '[1]')
    localStorage.setItem('repo-checkins-deleted', '[1,2,3]')
    localStorage.setItem('notes-drawer-pinned-deleted', 'true')

    const result = measureLocalStorage(['alive'])

    expect(result.orphaned).not.toBeNull()
    expect(result.orphaned?.keyCount).toBe(2)
    expect(result.orphaned?.bytes).toBe(
      bytesFor('repo-checkins-deleted', '[1,2,3]') +
        bytesFor('notes-drawer-pinned-deleted', 'true'),
    )

    const alive = result.entries.find((e) => e.key === 'repo-checkins-alive')
    expect(alive?.orphaned).toBe(false)
  })

  it('never marks a non-repo key as orphaned', () => {
    localStorage.setItem('auth_token', 'a')
    localStorage.setItem('sidebar_width', '240')

    const result = measureLocalStorage([])

    expect(result.orphaned?.keyCount).toBe(0)
    expect(result.entries.every((entry) => entry.orphaned !== true)).toBe(true)
  })

  it('expresses usage as a percentage of the ~5 MB quota', () => {
    const half = LOCAL_STORAGE_QUOTA_BYTES / 2
    // Each character of the value costs 2 bytes.
    localStorage.setItem('k', 'x'.repeat(half / 2 - 1))

    const result = measureLocalStorage()

    expect(result.quotaBytes).toBe(LOCAL_STORAGE_QUOTA_BYTES)
    expect(result.percentOfQuota).toBeGreaterThan(49)
    expect(result.percentOfQuota).toBeLessThan(51)
  })

  it('counts every key present, including ones RepoPulse does not own', () => {
    localStorage.setItem('some-other-app-key', 'value')

    expect(measureLocalStorage().entries).toHaveLength(1)
    expect(measureLocalStorage().totalBytes).toBeGreaterThan(0)
  })
})
