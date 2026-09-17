import { describe, it, expect } from 'vitest'
import {
  decodeCommitFilters,
  writeCommitFilters,
  isCommitFilterParam,
} from '@/lib/commitFilterParams'
import type { CommitFilterOptions, CommitFilters, CommitTypeFilter } from '@/types'

/**
 * The repo page's commit filters live in the query string, so these two
 * functions are the whole contract for "this URL means that view". Everything
 * shareable about the page is decided here.
 */

// Contributor ids are uuid4 in production, so the fixtures are too — the
// prefix rules only mean anything against a realistic id.
const ALICE_ID = '550e8400-e29b-41d4-a716-446655440000'
const BOB_ID = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'
// A third, so selecting two people is not the same as selecting everyone.
const CHEN_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'

const KNOWN: CommitFilterOptions = {
  branches: new Set(['main', 'feature/auth', 'a,b']),
  dates: new Set(['2026-09-10', '2026-09-11']),
  contributorIds: new Set([ALICE_ID, BOB_ID, CHEN_ID]),
}

/** Two ids agreeing on their first eight characters. */
const TWIN_A = '550e8400-e29b-41d4-a716-446655440000'
const TWIN_B = '550e8400-ffff-41d4-a716-446655440000'
const TWINS: CommitFilterOptions = { ...KNOWN, contributorIds: new Set([TWIN_A, TWIN_B]) }

/** Nothing has loaded yet, so nothing can be judged invalid. */
const UNKNOWN: CommitFilterOptions = { branches: null, dates: null, contributorIds: null }

function decode(search: string, options: CommitFilterOptions = KNOWN): CommitFilters {
  return decodeCommitFilters(new URLSearchParams(search), options)
}

function filters(partial: Partial<CommitFilters> = {}): CommitFilters {
  return {
    branches: new Set(),
    types: new Set(),
    date: '',
    contributorIds: new Set(),
    ...partial,
  }
}

describe('isCommitFilterParam', () => {
  it('claims the four filter keys', () => {
    expect(['branch', 'type', 'date', 'contributor'].every(isCommitFilterParam)).toBe(true)
  })

  it('leaves the deep-link params to their own effects', () => {
    expect(isCommitFilterParam('commit')).toBe(false)
    expect(isCommitFilterParam('note')).toBe(false)
  })
})

describe('decodeCommitFilters', () => {
  it('reads repeated branch params as one filter', () => {
    expect(Array.from(decode('?branch=main&branch=feature/auth').branches).sort())
      .toEqual(['feature/auth', 'main'])
  })

  it('reads a value repeated in the query string once', () => {
    expect(decode('?branch=main&branch=main').branches.size).toBe(1)
  })

  it('ignores a branch the repo no longer has', () => {
    expect(decode('?branch=deleted').branches.size).toBe(0)
  })

  it('keeps the valid branch alongside one it has to ignore', () => {
    expect(Array.from(decode('?branch=main&branch=deleted').branches)).toEqual(['main'])
  })

  it('trusts every branch while the repo is still loading', () => {
    expect(Array.from(decode('?branch=deleted', UNKNOWN).branches)).toEqual(['deleted'])
  })

  it('reads repeated type params as one filter', () => {
    expect(Array.from(decode('?type=substantive&type=unclassified').types).sort())
      .toEqual(['substantive', 'unclassified'])
  })

  it('ignores a type value that is not a commit type', () => {
    expect(decode('?type=substantive&type=bogus').types).toEqual(new Set(['substantive']))
  })

  it('ignores a bogus type even while the repo is still loading', () => {
    // Unlike branches, the type values are a closed set that never depends on
    // what the repo happens to contain.
    expect(decode('?type=bogus', UNKNOWN).types.size).toBe(0)
  })

  it('reads a day the repo has commits on', () => {
    expect(decode('?date=2026-09-10').date).toBe('2026-09-10')
  })

  it('ignores a malformed date', () => {
    expect(decode('?date=septemberish').date).toBe('')
  })

  it('ignores a date the repo has no commits on', () => {
    // The dropdown only offers days with commits, so this would otherwise
    // filter the table to nothing while the control reads "All".
    expect(decode('?date=1999-01-01').date).toBe('')
  })

  it('trusts a well-formed date while the repo is still loading', () => {
    expect(decode('?date=1999-01-01', UNKNOWN).date).toBe('1999-01-01')
  })

  it('expands a short contributor id to the person it names', () => {
    expect(Array.from(decode('?contributor=550e8400').contributorIds)).toEqual([ALICE_ID])
  })

  it('reads several short ids joined into one key', () => {
    expect(Array.from(decode('?contributor=550e8400.6ba7b810').contributorIds).sort())
      .toEqual([ALICE_ID, BOB_ID].sort())
  })

  it('still reads a full uuid, so links already in the wild keep working', () => {
    expect(Array.from(decode(`?contributor=${ALICE_ID}`).contributorIds)).toEqual([ALICE_ID])
  })

  it('still reads repeated contributor keys, as the first version wrote them', () => {
    expect(Array.from(decode(`?contributor=${ALICE_ID}&contributor=${BOB_ID}`).contributorIds).sort())
      .toEqual([ALICE_ID, BOB_ID].sort())
  })

  it('reads a short id whatever case it is written in', () => {
    expect(Array.from(decode('?contributor=550E8400').contributorIds)).toEqual([ALICE_ID])
  })

  it('ignores a contributor id the repo does not have', () => {
    // Merging a contributor destroys ids, so a shared link can rot.
    expect(decode('?contributor=99999999').contributorIds.size).toBe(0)
  })

  it('ignores a prefix too short to mean anything', () => {
    // Uniqueness alone would let a single character resolve in a small repo.
    expect(decode('?contributor=5').contributorIds.size).toBe(0)
  })

  it('ignores a prefix that names more than one person', () => {
    // Filtering to an arbitrary one of two people is worse than not filtering.
    expect(decode('?contributor=550e8400', TWINS).contributorIds.size).toBe(0)
  })

  it('ignores a value that is not a hex prefix of anything', () => {
    expect(decode('?contributor=alice').contributorIds.size).toBe(0)
  })

  it('expands the everyone sentinel to the whole roster', () => {
    // Needed as a real selection, not just an empty filter: the same set
    // drives Merge and the checkboxes.
    expect(Array.from(decode('?contributor=all').contributorIds).sort())
      .toEqual([ALICE_ID, BOB_ID, CHEN_ID].sort())
  })

  it('reads the everyone sentinel as no filter while the roster is loading', () => {
    expect(decode('?contributor=all', UNKNOWN).contributorIds.size).toBe(0)
  })

  it('keeps the short id that resolves alongside one that does not', () => {
    expect(Array.from(decode('?contributor=550e8400.99999999').contributorIds)).toEqual([ALICE_ID])
  })

  it('carries a short id verbatim while the contributors are still loading', () => {
    expect(Array.from(decode('?contributor=550e8400', UNKNOWN).contributorIds)).toEqual(['550e8400'])
  })

  it('reads an empty query string as no filters', () => {
    expect(decode('')).toEqual(filters())
  })

  it('reads a lone question mark as no filters', () => {
    expect(decode('?')).toEqual(filters())
  })

  it('ignores the deep-link params', () => {
    expect(decode('?commit=abc123&note=n-1')).toEqual(filters())
  })
})

describe('writeCommitFilters', () => {
  function write(
    search: string,
    next: Partial<CommitFilters>,
    options: CommitFilterOptions = KNOWN
  ): string {
    return writeCommitFilters(new URLSearchParams(search), filters(next), options).toString()
  }

  it('writes no keys when nothing is filtered', () => {
    expect(write('', {})).toBe('')
  })

  it('writes one key per branch rather than a comma list', () => {
    expect(write('', { branches: new Set(['main', 'dev']) })).toBe('branch=dev&branch=main')
  })

  it('keeps a branch name containing a comma in one value', () => {
    // Commas are legal in git refnames, which is why the values are not joined.
    const params = writeCommitFilters(
      new URLSearchParams(),
      filters({ branches: new Set(['a,b']) }),
      KNOWN
    )
    expect(params.getAll('branch')).toEqual(['a,b'])
  })

  it('writes types in chip order rather than selection order', () => {
    const selected = new Set<CommitTypeFilter>(['unclassified', 'substantive'])
    expect(write('', { types: selected })).toBe('type=substantive&type=unclassified')
  })

  it('writes the chosen day as a single key', () => {
    expect(write('', { date: '2026-09-10' })).toBe('date=2026-09-10')
  })

  it('omits the date key for the All option', () => {
    expect(write('?date=2026-09-10', { date: '' })).toBe('')
  })

  it('writes a contributor as a short id rather than a full uuid', () => {
    expect(write('', { contributorIds: new Set([ALICE_ID]) })).toBe('contributor=550e8400')
  })

  it('joins several contributors into one key', () => {
    // A dot, not a comma: URLSearchParams escapes a comma to %2C, which costs
    // three characters per separator and is exactly what this avoids.
    expect(write('', { contributorIds: new Set([BOB_ID, ALICE_ID]) }))
      .toBe('contributor=550e8400.6ba7b810')
  })

  it('writes the whole id when a short one would name two people', () => {
    expect(write('', { contributorIds: new Set([TWIN_A]) }, TWINS)).toBe(`contributor=${TWIN_A}`)
  })

  it('leaves an id that is not a uuid whole', () => {
    // The shortening holds only because uuids do not collide. Any other shape
    // of id could be split apart by a later unmerge and stop resolving.
    const named: CommitFilterOptions = {
      ...KNOWN,
      contributorIds: new Set(['contrib-1', 'contrib-2']),
    }
    expect(write('', { contributorIds: new Set(['contrib-1']) }, named))
      .toBe('contributor=contrib-1')
  })

  it('writes a value it cannot shorten as it stands', () => {
    expect(write('', { contributorIds: new Set(['550e8400']) }, UNKNOWN))
      .toBe('contributor=550e8400')
  })

  it('omits the contributor key when nobody is selected', () => {
    expect(write(`?contributor=${ALICE_ID}`, {})).toBe('')
  })

  it('writes the everyone sentinel rather than the whole roster', () => {
    // Listing everyone is the longest a selection can get and filters nothing.
    expect(write('', { contributorIds: new Set([ALICE_ID, BOB_ID, CHEN_ID]) }))
      .toBe('contributor=all')
  })

  it('writes ids again as soon as the selection is not everyone', () => {
    expect(write('?contributor=all', { contributorIds: new Set([BOB_ID]) }))
      .toBe('contributor=6ba7b810')
  })

  it('does not claim everyone while the roster is unknown', () => {
    expect(write('', { contributorIds: new Set([ALICE_ID]) }, UNKNOWN))
      .toBe(`contributor=${ALICE_ID}`)
  })

  it('round-trips the everyone sentinel', () => {
    const everyone = decodeCommitFilters(new URLSearchParams('?contributor=all'), KNOWN)
    expect(writeCommitFilters(new URLSearchParams(), everyone, KNOWN).toString())
      .toBe('contributor=all')
  })

  it('produces the same string for the same selection whatever the insertion order', () => {
    // Identical output is what makes a redundant write a true no-op, so an
    // unrelated param change cannot churn the derived filters.
    expect(write('', { branches: new Set(['main', 'dev']) }))
      .toBe(write('', { branches: new Set(['dev', 'main']) }))
  })

  it('replaces the previous filter values rather than appending to them', () => {
    expect(write('?branch=main', { branches: new Set(['dev']) })).toBe('branch=dev')
  })

  it('carries a commit deep link through untouched', () => {
    expect(write('?commit=abc123', { branches: new Set(['main']) }))
      .toBe('commit=abc123&branch=main')
  })

  it('carries a note deep link through untouched', () => {
    expect(write('?note=n-1', {})).toBe('note=n-1')
  })

  it('carries an unrelated param through untouched', () => {
    expect(write('?ref=email', { date: '2026-09-10' })).toBe('ref=email&date=2026-09-10')
  })

  it('round-trips a full selection through decode', () => {
    const selection = filters({
      branches: new Set(['main', 'feature/auth']),
      types: new Set<CommitTypeFilter>(['substantive']),
      date: '2026-09-10',
      contributorIds: new Set([ALICE_ID]),
    })
    const written = writeCommitFilters(new URLSearchParams('?commit=abc123'), selection, KNOWN)
    expect(decodeCommitFilters(written, KNOWN)).toEqual(selection)
    expect(written.get('commit')).toBe('abc123')
  })
})
