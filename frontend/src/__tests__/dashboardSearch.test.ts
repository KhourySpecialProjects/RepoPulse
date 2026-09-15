import { describe, it, expect } from 'vitest'
import { searchWorkspace, damerauLevenshtein, MIN_QUERY_LENGTH } from '@/lib/dashboardSearch'
import type { PersonEntry } from '@/lib/dashboardSearch'
import type { Repo } from '@/types'

function repo(name: string, id = name): Repo {
  return {
    id,
    collection_id: 'col-1',
    github_url: `https://github.com/x/${name}`,
    name,
    local_path: null,
    health_status: 'green',
    health_score: null,
    last_synced_at: null,
    last_commit_at: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    contributor_count: 1,
    active_reminder_count: 0,
    expected_contributor_count: null,
    sync_status: 'idle',
    sync_started_at: null,
    sync_started_by_name: null,
    sync_error: null,
  }
}

const person = (name: string, repoName = 'alpha', id = `${name}-${repoName}`): PersonEntry => ({
  id,
  name,
  repoId: repoName,
  repoName,
})

describe('searchWorkspace', () => {
  it('finds repositories by a fragment of the name, ignoring case', () => {
    const results = searchWorkspace({
      repos: [repo('capstone-api'), repo('frontend-app')],
      people: [],
      query: 'API',
    })

    expect(results.repos.map(r => r.name)).toEqual(['capstone-api'])
  })

  it('finds people by a fragment of the name and says which repo they are in', () => {
    const results = searchWorkspace({
      repos: [],
      people: [person('Alice Nguyen', 'capstone-api'), person('Bob Ray', 'frontend-app')],
      query: 'ngu',
    })

    expect(results.people).toHaveLength(1)
    expect(results.people[0].name).toBe('Alice Nguyen')
    expect(results.people[0].repoName).toBe('capstone-api')
  })

  it('returns repositories and people together', () => {
    const results = searchWorkspace({
      repos: [repo('alpha')],
      people: [person('Alpha Student')],
      query: 'alph',
    })

    expect(results.repos).toHaveLength(1)
    expect(results.people).toHaveLength(1)
  })

  // Otherwise the dropdown opens on the first keystroke showing everything,
  // which is noise rather than a search.
  it('stays quiet until the query is worth running', () => {
    const args = { repos: [repo('alpha')], people: [person('Alice')], query: 'a' }

    const nothing = { repos: [], people: [], suggestions: { repos: [], people: [] } }

    expect(MIN_QUERY_LENGTH).toBe(2)
    expect(searchWorkspace(args)).toEqual(nothing)
    expect(searchWorkspace({ ...args, query: '' })).toEqual(nothing)
    expect(searchWorkspace({ ...args, query: '   ' })).toEqual(nothing)
  })

  it('ignores surrounding whitespace', () => {
    const results = searchWorkspace({ repos: [repo('alpha')], people: [], query: '  alpha  ' })

    expect(results.repos).toHaveLength(1)
  })

  it('puts names that start with the query above names that merely contain it', () => {
    const results = searchWorkspace({
      repos: [repo('my-api-client'), repo('api-server')],
      people: [],
      query: 'api',
    })

    expect(results.repos.map(r => r.name)).toEqual(['api-server', 'my-api-client'])
  })

  it('breaks ties alphabetically so the order never jitters', () => {
    const results = searchWorkspace({
      repos: [repo('team-zeta'), repo('team-alpha'), repo('team-mid')],
      people: [],
      query: 'team',
    })

    expect(results.repos.map(r => r.name)).toEqual(['team-alpha', 'team-mid', 'team-zeta'])
  })

  it('caps each group so the dropdown cannot run off the screen', () => {
    const results = searchWorkspace({
      repos: Array.from({ length: 30 }, (_, i) => repo(`team-${i}`, `r${i}`)),
      people: Array.from({ length: 30 }, (_, i) => person(`Team Member ${i}`, 'alpha', `p${i}`)),
      query: 'team',
      limit: 4,
    })

    expect(results.repos).toHaveLength(4)
    expect(results.people).toHaveLength(4)
  })

  // The same contributor shows up once per repo they commit to, and which repo
  // is the useful part, so those are separate hits rather than a duplicate.
  it('keeps one hit per repo a person contributes to', () => {
    const results = searchWorkspace({
      repos: [],
      people: [person('Alice', 'alpha', 'a1'), person('Alice', 'beta', 'a2')],
      query: 'alice',
    })

    expect(results.people.map(p => p.repoName)).toEqual(['alpha', 'beta'])
  })

  it('reports no suggestions when the query matched exactly', () => {
    const results = searchWorkspace({
      repos: [repo('capstone-api')],
      people: [],
      query: 'capstone',
    })

    expect(results.repos).toHaveLength(1)
    expect(results.suggestions).toEqual({ repos: [], people: [] })
  })

  it('drops people the activity feed gave no name', () => {
    const results = searchWorkspace({
      repos: [],
      people: [person('', 'alpha', 'blank'), person('Alice', 'alpha', 'a1')],
      query: 'ali',
    })

    expect(results.people.map(p => p.id)).toEqual(['a1'])
  })
})


describe('damerauLevenshtein', () => {
  it('counts each kind of single-character slip as one edit', () => {
    expect(damerauLevenshtein('alice', 'alice')).toBe(0)
    expect(damerauLevenshtein('alicz', 'alice')).toBe(1) // substitution
    expect(damerauLevenshtein('alic', 'alice')).toBe(1) // deletion
    expect(damerauLevenshtein('alicee', 'alice')).toBe(1) // insertion
    // Transposition is the most common real typo, and plain Levenshtein
    // charges two edits for it.
    expect(damerauLevenshtein('alcie', 'alice')).toBe(1)
  })

  it('is symmetric', () => {
    expect(damerauLevenshtein('capstoen', 'capstone')).toBe(
      damerauLevenshtein('capstone', 'capstoen')
    )
  })
})

/**
 * A typo means the substring match finds nothing, so these near-misses are
 * offered separately rather than mixed into the results — a good query stays
 * free of fuzzy noise, and a misspelled one still lands somewhere.
 */
describe('searchWorkspace — typo tolerance', () => {
  it('suggests a repository when the query has a transposed pair', () => {
    const results = searchWorkspace({
      repos: [repo('capstone-api'), repo('frontend-app')],
      people: [],
      query: 'capstoen',
    })

    expect(results.repos).toEqual([])
    expect(results.suggestions.repos.map(r => r.name)).toEqual(['capstone-api'])
  })

  it('suggests a person when their name is misspelled', () => {
    const results = searchWorkspace({
      repos: [],
      people: [person('Alice Nguyen', 'capstone-api'), person('Bob Ray', 'frontend-app')],
      query: 'Alcie',
    })

    expect(results.people).toEqual([])
    expect(results.suggestions.people.map(p => p.name)).toEqual(['Alice Nguyen'])
  })

  // Names are matched a word at a time, so a typo in a surname still resolves
  // without the first name counting against the edit budget.
  it('matches a misspelling of any single word in a name', () => {
    const results = searchWorkspace({
      repos: [],
      people: [person('Alice Nguyen')],
      query: 'Nguyan',
    })

    expect(results.suggestions.people.map(p => p.name)).toEqual(['Alice Nguyen'])
  })

  it('splits hyphenated repository names into words too', () => {
    const results = searchWorkspace({
      repos: [repo('capstone-api')],
      people: [],
      query: 'apy',
    })

    expect(results.suggestions.repos.map(r => r.name)).toEqual(['capstone-api'])
  })

  it('allows more slack in a long query than a short one', () => {
    const short = searchWorkspace({ repos: [repo('team')], people: [], query: 'txym' })
    // Two edits in a four-character query is a different word, not a typo.
    expect(short.suggestions.repos).toEqual([])

    const long = searchWorkspace({ repos: [repo('frontend')], people: [], query: 'frontnd' })
    expect(long.suggestions.repos.map(r => r.name)).toEqual(['frontend'])
  })

  it('offers nothing for a query that resembles nothing', () => {
    const results = searchWorkspace({
      repos: [repo('capstone-api')],
      people: [person('Alice')],
      query: 'qqqqqqq',
    })

    expect(results.suggestions).toEqual({ repos: [], people: [] })
  })

  it('puts the closest spelling first', () => {
    const results = searchWorkspace({
      repos: [repo('front', 'r-front'), repo('frontend', 'r-frontend')],
      people: [],
      query: 'frontnd',
    })

    expect(results.suggestions.repos.map(r => r.name)).toEqual(['frontend', 'front'])
  })

  it('stays quiet on a two-character query, where everything is one edit away', () => {
    const results = searchWorkspace({ repos: [repo('api')], people: [], query: 'ap' })

    expect(results.suggestions.repos).toEqual([])
  })

  it('caps the suggestions like the results', () => {
    const results = searchWorkspace({
      repos: Array.from({ length: 20 }, (_, i) => repo(`frontend${i}`, `r${i}`)),
      people: [],
      query: 'frontnd',
      limit: 3,
    })

    expect(results.suggestions.repos).toHaveLength(3)
  })
})
