import type { Repo } from '@/types'

/**
 * One contributor, in one repository.
 *
 * People are only reachable per-repo, and *which* repo someone is in is the
 * useful half of finding them, so the pairing is the unit of search rather
 * than the contributor alone.
 */
export interface PersonEntry {
  id: string
  name: string
  repoId: string
  repoName: string
}

export interface SearchResults {
  repos: Repo[]
  people: PersonEntry[]
  /**
   * Near-misses for a misspelled query, populated only when the exact match
   * found nothing. Kept apart from the results so a good query never has fuzzy
   * noise mixed into it.
   */
  suggestions: { repos: Repo[]; people: PersonEntry[] }
}

/** A single character matches most of the workspace, which is not a search. */
export const MIN_QUERY_LENGTH = 2

const DEFAULT_LIMIT = 5

/**
 * Edit distance counting a swap of two neighbours as one edit, not two.
 *
 * That case matters more than the rest put together: "Alcie" for "Alice" and
 * "capstoen" for "capstone" are the typos people actually make, and plain
 * Levenshtein prices them the same as two unrelated mistakes.
 */
export function damerauLevenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length

  // Three rows are enough: a transposition only ever looks back two rows.
  let twoBack: number[] = []
  let oneBack: number[] = Array.from({ length: b.length + 1 }, (_, i) => i)
  let current: number[] = []

  for (let i = 1; i <= a.length; i += 1) {
    current = [i]
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = oneBack[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      const insertion = current[j - 1] + 1
      const deletion = oneBack[j] + 1
      let best = Math.min(substitution, insertion, deletion)

      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        best = Math.min(best, twoBack[j - 2] + 1)
      }
      current[j] = best
    }
    twoBack = oneBack
    oneBack = current
  }

  return current[b.length]
}

/**
 * How wrong a query may be before it stops being a typo.
 *
 * Scaled to length because two edits in a four-letter word is a different
 * word, while two edits in "frontend" is still plainly "frontend".
 */
function maxEdits(queryLength: number): number {
  if (queryLength <= 2) return 0
  if (queryLength <= 5) return 1
  return 2
}

/** Words, split on whitespace and the separators repo names actually use. */
function words(name: string): string[] {
  return name.toLowerCase().split(/[\s\-_./]+/).filter(Boolean)
}

/**
 * Distance from the query to the closest word in `name`, or `null` if nothing
 * in it is close enough to be a typo.
 *
 * Word-at-a-time rather than whole-name: a query is usually one word, and
 * comparing "nguyan" to "alice nguyen" would spend the entire edit budget on
 * the part the reader got right.
 */
function typoDistance(name: string, query: string): number | null {
  const budget = maxEdits(query.length)
  if (budget === 0) return null

  let best: number | null = null
  for (const word of words(name)) {
    const distance = damerauLevenshtein(query, word)
    if (distance <= budget && (best === null || distance < best)) best = distance
  }
  return best
}

/**
 * Prefix hits first, then alphabetical.
 *
 * Alphabetical is doing real work here: without a total order, two equally
 * ranked hits swap places as the underlying arrays re-fetch, and the row under
 * the cursor changes out from under a keyboard user.
 */
function rankBy(name: string, query: string): [number, string] {
  const lower = name.toLowerCase()
  return [lower.startsWith(query) ? 0 : 1, lower]
}

function compareRanked(a: [number, string], b: [number, string]): number {
  return a[0] - b[0] || a[1].localeCompare(b[1])
}

/** Closest spelling first, then alphabetical for the same reason as above. */
function byDistanceThenName<T>(items: Array<{ item: T; distance: number; name: string }>): T[] {
  return [...items]
    .sort((a, b) => a.distance - b.distance || a.name.localeCompare(b.name))
    .map(entry => entry.item)
}

/** A contributor with no resolved name renders as a blank, unpickable row. */
const isNamed = (person: PersonEntry) => person.name.trim() !== ''

/**
 * Substring match over repository and contributor names, case-insensitive,
 * falling back to typo-tolerant suggestions when nothing matches.
 */
export function searchWorkspace({
  repos,
  people,
  query,
  limit = DEFAULT_LIMIT,
}: {
  repos: Repo[]
  people: PersonEntry[]
  query: string
  limit?: number
}): SearchResults {
  const empty = { repos: [], people: [] }
  const needle = query.trim().toLowerCase()
  if (needle.length < MIN_QUERY_LENGTH) return { ...empty, suggestions: empty }

  const named = people.filter(isNamed)

  const matchedRepos = repos
    .filter(repo => repo.name.toLowerCase().includes(needle))
    .sort((a, b) => compareRanked(rankBy(a.name, needle), rankBy(b.name, needle)))
    .slice(0, limit)

  const matchedPeople = named
    .filter(person => person.name.toLowerCase().includes(needle))
    .sort((a, b) => compareRanked(rankBy(a.name, needle), rankBy(b.name, needle)))
    .slice(0, limit)

  if (matchedRepos.length > 0 || matchedPeople.length > 0) {
    return { repos: matchedRepos, people: matchedPeople, suggestions: empty }
  }

  const nearRepos = repos.flatMap(repo => {
    const distance = typoDistance(repo.name, needle)
    return distance === null ? [] : [{ item: repo, distance, name: repo.name.toLowerCase() }]
  })
  const nearPeople = named.flatMap(person => {
    const distance = typoDistance(person.name, needle)
    return distance === null ? [] : [{ item: person, distance, name: person.name.toLowerCase() }]
  })

  return {
    repos: [],
    people: [],
    suggestions: {
      repos: byDistanceThenName(nearRepos).slice(0, limit),
      people: byDistanceThenName(nearPeople).slice(0, limit),
    },
  }
}
