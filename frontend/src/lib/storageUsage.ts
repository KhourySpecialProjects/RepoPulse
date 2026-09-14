/**
 * Measure what RepoPulse stores in this browser's localStorage.
 *
 * Why this exists: three key families are written per repo and never cleaned
 * up — not on repo deletion (removal is server-side and explicitly does not
 * touch the browser), not on logout (only the two auth keys are cleared).
 * Across semesters of adding and removing repos an origin accumulates
 * orphaned keys against a hard ~5 MB quota, and `repo-checkins-{repoId}`
 * stores a JSON array that only grows.
 *
 * The failure is silent: NotesDrawer swallows QuotaExceededError in a bare
 * `catch {}`, and RepoDetailPage's saveCheckIns has no try/catch at all. So
 * the first symptom is a pin not persisting, not an error — which is exactly
 * why an administrator needs a number.
 *
 * This is measurement only. It never writes or removes anything.
 */

/** Browsers converge on ~5 MB per origin. Not queryable, so it is a constant. */
export const LOCAL_STORAGE_QUOTA_BYTES = 5 * 1024 * 1024

export type StorageCategory = 'auth' | 'ui-pref' | 'per-repo' | 'other'

export interface StorageEntry {
  key: string
  bytes: number
  category: StorageCategory
  /** The repo id embedded in a per-repo key; null for every other category. */
  repoId: string | null
  /** true/false once the live repo set is known, null when it is not. */
  orphaned: boolean | null
}

export interface StorageMeasurement {
  /** Every key present, largest first. */
  entries: StorageEntry[]
  totalBytes: number
  quotaBytes: number
  percentOfQuota: number
  perRepo: { keyCount: number; bytes: number }
  /** null when no repo list was supplied — unknown is not the same as zero. */
  orphaned: { keyCount: number; bytes: number } | null
}

/** Cleared on logout by services/api.ts. */
const AUTH_KEYS = new Set(['auth_token', 'auth_user'])

/** Fixed-size UI state, except sidebar_expanded_collections which tracks collections. */
const UI_PREF_KEYS = new Set([
  'sidebar_collapsed',
  'sidebar_width',
  'sidebar_expanded_collections',
])

/**
 * Key families written once per repo and never removed.
 * Order matters only for id extraction, not classification.
 */
const PER_REPO_PREFIXES = [
  'notes-drawer-pinned-',
  'repo-pull-requests-expanded-',
  'repo-checkins-',
] as const

function classify(key: string): { category: StorageCategory; repoId: string | null } {
  if (AUTH_KEYS.has(key)) return { category: 'auth', repoId: null }
  if (UI_PREF_KEYS.has(key)) return { category: 'ui-pref', repoId: null }

  for (const prefix of PER_REPO_PREFIXES) {
    if (key.startsWith(prefix)) {
      return { category: 'per-repo', repoId: key.slice(prefix.length) }
    }
  }

  return { category: 'other', repoId: null }
}

/**
 * Bytes a browser charges against quota: UTF-16 code units for key and value.
 *
 * `.length` counts code units, which is the right unit here — an astral
 * character is 2 units and genuinely costs 4 bytes.
 */
function byteSize(key: string, value: string): number {
  return (key.length + value.length) * 2
}

/**
 * null means "not checked", which is distinct from false.
 * Rendering unknown as "0 orphaned" would be a claim we cannot support.
 */
function orphanStatus(
  category: StorageCategory,
  repoId: string | null,
  live: Set<string> | null,
): boolean | null {
  if (live === null) return null
  if (category !== 'per-repo' || repoId === null) return false
  return !live.has(repoId)
}

const EMPTY: StorageMeasurement = {
  entries: [],
  totalBytes: 0,
  quotaBytes: LOCAL_STORAGE_QUOTA_BYTES,
  percentOfQuota: 0,
  perRepo: { keyCount: 0, bytes: 0 },
  orphaned: null,
}

/**
 * Measure this browser's localStorage.
 *
 * @param knownRepoIds Ids of repos that still exist. Supply it and per-repo
 *   keys for absent repos are reported as orphaned; omit it and orphan status
 *   stays null, because "we did not check" must not render as "none found".
 */
export function measureLocalStorage(
  knownRepoIds?: Iterable<string>,
): StorageMeasurement {
  let store: Storage
  try {
    store = window.localStorage
    // Touch it: access can throw outright when storage is disabled.
    void store.length
  } catch {
    return { ...EMPTY }
  }

  const live = knownRepoIds === undefined ? null : new Set(knownRepoIds)
  const entries: StorageEntry[] = []
  let totalBytes = 0

  for (let index = 0; index < store.length; index += 1) {
    const key = store.key(index)
    if (key === null) continue
    const value = store.getItem(key) ?? ''
    const { category, repoId } = classify(key)
    const bytes = byteSize(key, value)
    totalBytes += bytes

    entries.push({
      key,
      bytes,
      category,
      repoId,
      orphaned: orphanStatus(category, repoId, live),
    })
  }

  entries.sort((a, b) => b.bytes - a.bytes)

  const perRepoEntries = entries.filter((entry) => entry.category === 'per-repo')
  const orphanEntries = entries.filter((entry) => entry.orphaned === true)

  return {
    entries,
    totalBytes,
    quotaBytes: LOCAL_STORAGE_QUOTA_BYTES,
    percentOfQuota: (totalBytes / LOCAL_STORAGE_QUOTA_BYTES) * 100,
    perRepo: {
      keyCount: perRepoEntries.length,
      bytes: perRepoEntries.reduce((sum, entry) => sum + entry.bytes, 0),
    },
    orphaned:
      live === null
        ? null
        : {
            keyCount: orphanEntries.length,
            bytes: orphanEntries.reduce((sum, entry) => sum + entry.bytes, 0),
          },
  }
}
