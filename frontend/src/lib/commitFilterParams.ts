import { COMMIT_TYPE_FILTERS } from '@/lib/commitTypeStyles'
import type { CommitFilterOptions, CommitFilters, CommitTypeFilter } from '@/types'

/**
 * The repo page's commit filters, encoded in the query string.
 *
 *   branch       repeated  `?branch=main&branch=feature/auth`
 *   type         repeated  `?type=substantive`
 *   date         single    `?date=2026-09-10`
 *   contributor  joined    `?contributor=550e8400.6ba7b810`, or `all`
 *
 * An absent key means "All", so a copied URL carries only what is actually
 * narrowing the view.
 *
 * Branch and type use repeated keys: a branch name may legally contain any
 * separator worth picking. Contributors are UUIDs, so they are joined into one
 * key instead — three people came to 146 characters of query string with a key
 * apiece, which is most of a URL spent on ids nobody reads.
 *
 * Two savings, both on the contributor key:
 *
 *  - Values are an 8-character prefix of the id, resolved the way git resolves
 *    a short SHA. A repo has tens of contributors, not millions, so a prefix
 *    names one of them. A full UUID is still a prefix of itself, so links
 *    already in the wild keep working.
 *  - `.` joins them rather than `,`: URLSearchParams escapes a comma to `%2C`,
 *    which costs three characters per separator and reads worse. A dot is
 *    neither a hex digit nor part of a UUID, so it cannot be ambiguous.
 *
 * Everyone being selected is written as `all` rather than as the roster. As a
 * filter it is a no-op — the page shows the same commits either way — so
 * spelling out every id says nothing and costs the most characters of any
 * selection. It is not dropped altogether because the same selection also
 * drives Merge and the checkboxes, which do have to tell "everyone" from
 * "nobody". `all` also ages better than a frozen roster: a link shared as
 * "everyone" still means everyone once another contributor appears.
 *
 * These names belong to the commit list. Anything else on the page that grows
 * a URL filter — the pull-request state, say — must prefix its key (`prState`)
 * rather than claim a bare noun.
 *
 * Two deliberate omissions:
 *
 *  - `commit` and `note` are *transient* deep links owned by RepoDetailPage's
 *    own effects, which consume and then delete them. Every function here
 *    carries unrelated keys through untouched so those effects keep working.
 *  - `date` is a day in the *viewer's* timezone, matching the date shown in
 *    each commit row. A link shared across timezones can therefore resolve to
 *    a slightly different set of commits; agreeing with the row above the
 *    fold is worth more than agreeing across continents.
 */

export const COMMIT_FILTER_PARAM_KEYS = ['branch', 'type', 'date', 'contributor'] as const

type CommitFilterParamKey = (typeof COMMIT_FILTER_PARAM_KEYS)[number]

export function isCommitFilterParam(key: string): key is CommitFilterParamKey {
  return (COMMIT_FILTER_PARAM_KEYS as readonly string[]).includes(key)
}

/** The raw strings for the four keys, before any validation. */
export interface RawCommitFilterValues {
  branch: string[]
  type: string[]
  date: string
  contributor: string[]
}

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/

/** Joins the contributor ids. See the note above on why not a comma. */
const CONTRIBUTOR_SEPARATOR = '.'

/**
 * Stands in for the whole roster. Safe as a sentinel because it can never be
 * an id: `l` is not a hex digit, so no prefix could ever spell it.
 */
const CONTRIBUTOR_ALL = 'all'

/** How much of a contributor's UUID goes in the URL. */
const SHORT_ID_LENGTH = 8

/**
 * Shortest prefix that is allowed to stand for an id, mirroring git's own
 * floor on short SHAs. Uniqueness is still required on top of this; the floor
 * only stops a stray character or two from resolving to a real person.
 */
const MIN_SHORT_ID_LENGTH = 4

/**
 * Only a uuid gets shortened, and only a hex string is read as a prefix.
 *
 * The gate matters because the shortening is computed against the contributor
 * list as it stands, and that list changes — an unmerge splits one person into
 * two. Two uuids agreeing on eight hex characters is a one-in-four-billion
 * event, so a written prefix stays unambiguous; ids of some other shape carry
 * no such guarantee and are left whole.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const HEX = /^[0-9a-f]+$/i

function isCommitTypeFilter(value: string): value is CommitTypeFilter {
  return (COMMIT_TYPE_FILTERS as string[]).includes(value)
}

/** One list of ids from however many `contributor` keys the URL carries. */
function splitContributorValues(values: string[]): string[] {
  return values
    .flatMap(value => value.split(CONTRIBUTOR_SEPARATOR))
    .map(value => value.trim())
    .filter(Boolean)
}

/**
 * Is every contributor the repo has part of this selection?
 *
 * A roster of one does not count. Selecting that person and selecting everyone
 * are the same click, so there is nothing to collapse — and the difference
 * becomes real the moment the roster grows, which an unmerge does. Recorded as
 * `all`, a selection of one person would quietly swallow whoever appeared
 * next; recorded as their id, it still means them.
 */
function coversEveryone(
  selected: ReadonlySet<string>,
  known: ReadonlySet<string> | null
): boolean {
  if (known === null || known.size <= 1) return false
  return Array.from(known).every(id => selected.has(id))
}

/**
 * Expands a URL value to the contributor id it names, or null if it names
 * none. Exact ids resolve whatever their length, so a link written before the
 * prefixes existed still works.
 */
function resolveContributorId(raw: string, known: ReadonlySet<string>): string | null {
  if (known.has(raw)) return raw
  if (raw.length < MIN_SHORT_ID_LENGTH || !HEX.test(raw)) return null

  const prefix = raw.toLowerCase()
  const matches: string[] = []
  known.forEach(candidate => {
    if (candidate.toLowerCase().startsWith(prefix)) matches.push(candidate)
  })
  // An ambiguous prefix is treated like an unknown one: filtering to an
  // arbitrary one of two people is worse than not filtering.
  return matches.length === 1 ? matches[0] : null
}

/** The shortest form of an id that still names only that contributor. */
function shortenContributorId(id: string, known: ReadonlySet<string> | null): string {
  if (known === null || !UUID.test(id)) return id
  const short = id.slice(0, SHORT_ID_LENGTH)

  let matches = 0
  known.forEach(candidate => {
    if (candidate.startsWith(short)) matches += 1
  })
  // Widen rather than guess, exactly as git does when a short SHA collides.
  return matches === 1 ? short : id
}

/** Drops values the repo does not have; keeps everything while `known` is null. */
function keepKnown(values: string[], known: ReadonlySet<string> | null): Set<string> {
  return new Set(known ? values.filter(v => known.has(v)) : values)
}

/**
 * Validates already-extracted param values.
 *
 * Separate from `decodeCommitFilters` so the hook can memoize on plain strings
 * rather than on a `URLSearchParams` object, whose identity changes on every
 * write — including writes to params that have nothing to do with filtering.
 */
export function decodeCommitFilterValues(
  raw: RawCommitFilterValues,
  options: CommitFilterOptions
): CommitFilters {
  // A syntactically valid day the repo has no commits on is as bad as a
  // malformed one: the dropdown offers only days with commits, so it would
  // read "All" while the table showed nothing.
  const dateIsUsable =
    DATE_KEY.test(raw.date) && (options.dates === null || options.dates.has(raw.date))

  // Nothing to resolve a short id against yet, so the raw values are carried
  // as they stand and resolve on the render after the contributors land.
  const knownIds = options.contributorIds
  const contributorValues = splitContributorValues(raw.contributor)
  const contributorIds = contributorValues.includes(CONTRIBUTOR_ALL)
    ? // Before the roster lands there is nothing to expand to, and an empty
      // set is the same filter anyway — which also avoids a flash of an empty
      // table on the way in.
      Array.from(knownIds ?? [])
    : knownIds === null
      ? contributorValues
      : contributorValues
          .map(value => resolveContributorId(value, knownIds))
          .filter((id): id is string => id !== null)

  return {
    branches: keepKnown(raw.branch, options.branches),
    // The three type values are a closed set, so they are validated even
    // before anything has loaded.
    types: new Set(raw.type.filter(isCommitTypeFilter)),
    date: dateIsUsable ? raw.date : '',
    contributorIds: new Set(contributorIds),
  }
}

/** Reads the filters out of a query string. */
export function decodeCommitFilters(
  params: URLSearchParams,
  options: CommitFilterOptions
): CommitFilters {
  return decodeCommitFilterValues(
    {
      branch: params.getAll('branch'),
      type: params.getAll('type'),
      date: params.get('date') ?? '',
      contributor: params.getAll('contributor'),
    },
    options
  )
}

/**
 * Rebuilds the four filter keys from `next`, carrying every other key through.
 *
 * Values come out sorted (types in chip order), so one selection is always one
 * byte-identical query string. That is what makes a redundant write a true
 * no-op: react-router memoizes `searchParams` on `location.search`, so an
 * unchanged string hands back the same object and the derived filters do not
 * churn. It also means a value that `decodeCommitFilters` had to ignore
 * disappears from the URL the first time the user touches any filter.
 */
export function writeCommitFilters(
  current: URLSearchParams,
  next: CommitFilters,
  options: CommitFilterOptions
): URLSearchParams {
  const out = new URLSearchParams()
  // Non-filter keys first, so `?commit=`/`?note=` survive a filter click.
  current.forEach((value, key) => {
    if (!isCommitFilterParam(key)) out.append(key, value)
  })

  Array.from(next.branches).sort().forEach(branch => out.append('branch', branch))
  COMMIT_TYPE_FILTERS.filter(type => next.types.has(type)).forEach(type => out.append('type', type))
  if (next.date) out.set('date', next.date)
  if (coversEveryone(next.contributorIds, options.contributorIds)) {
    out.set('contributor', CONTRIBUTOR_ALL)
  } else if (next.contributorIds.size > 0) {
    out.set(
      'contributor',
      Array.from(next.contributorIds)
        .map(id => shortenContributorId(id, options.contributorIds))
        .sort()
        .join(CONTRIBUTOR_SEPARATOR)
    )
  }

  return out
}
