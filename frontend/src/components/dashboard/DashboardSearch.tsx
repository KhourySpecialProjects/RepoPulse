import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, GitBranch, User, X } from 'lucide-react'
import { MIN_QUERY_LENGTH, searchWorkspace } from '@/lib/dashboardSearch'
import type { PersonEntry } from '@/lib/dashboardSearch'
import { useBackState } from '@/hooks/useBackTarget'
import { cn } from '@/lib/utils'
import type { Repo } from '@/types'

/** A flat list of what the arrow keys walk, whatever group a row sits in. */
interface Hit {
  kind: 'repo' | 'person'
  key: string
  label: string
  detail: string
  to: string
  Icon: typeof GitBranch
}

function repoHit(repo: Repo, prefix: string): Hit {
  return {
    kind: 'repo',
    key: `${prefix}repo-${repo.id}`,
    label: repo.name,
    detail: `${repo.contributor_count} contributor${repo.contributor_count === 1 ? '' : 's'}`,
    to: `/repos/${repo.id}`,
    Icon: GitBranch,
  }
}

function personHit(person: PersonEntry, prefix: string): Hit {
  return {
    kind: 'person',
    key: `${prefix}person-${person.id}-${person.repoId}`,
    label: person.name,
    detail: `in ${person.repoName}`,
    // The repo page reads this and preselects them, so the reader lands on
    // that person's commits rather than on an unexplained repo.
    to: `/repos/${person.repoId}?contributor=${encodeURIComponent(person.id)}`,
    Icon: User,
  }
}

/**
 * Workspace search for repositories and people.
 *
 * People are passed in rather than fetched here: they cost a request per
 * collection, so the page owns that decision and `onPeopleNeeded` tells it when
 * a query has actually been typed.
 */
export function DashboardSearch({
  repos,
  people,
  onPeopleNeeded,
  peopleLoading = false,
  className,
}: {
  repos: Repo[]
  people: PersonEntry[]
  onPeopleNeeded?: () => void
  peopleLoading?: boolean
  className?: string
}) {
  const navigate = useNavigate()
  const backState = useBackState()
  const listId = useId()
  const rootRef = useRef<HTMLDivElement>(null)

  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [cursor, setCursor] = useState(-1)

  const isSearching = query.trim().length >= MIN_QUERY_LENGTH

  // Contributors are fetched lazily, so the page needs telling the moment a
  // query becomes real rather than on every keystroke before that.
  useEffect(() => {
    if (isSearching) onPeopleNeeded?.()
  }, [isSearching, onPeopleNeeded])

  const results = useMemo(
    () => searchWorkspace({ repos, people, query }),
    [repos, people, query]
  )

  const repoHits = useMemo(() => results.repos.map(repo => repoHit(repo, '')), [results.repos])
  const personHits = useMemo(
    () => results.people.map(person => personHit(person, '')),
    [results.people]
  )
  // Suggestions only exist when the exact match found nothing, so they never
  // compete with the groups above — but they are keyboard-reachable all the
  // same, which is why they join the same flat list.
  const suggestionHits = useMemo(
    () => [
      ...results.suggestions.repos.map(repo => repoHit(repo, 'near-')),
      ...results.suggestions.people.map(person => personHit(person, 'near-')),
    ],
    [results.suggestions]
  )

  const hits: Hit[] = useMemo(
    () => [...repoHits, ...personHits, ...suggestionHits],
    [repoHits, personHits, suggestionHits]
  )

  // A stale cursor would highlight a row that no longer exists, or open the
  // wrong one on Enter.
  useEffect(() => setCursor(-1), [query])

  useEffect(() => {
    if (!open) return
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  function go(hit: Hit) {
    setOpen(false)
    setQuery('')
    navigate(hit.to, { state: backState })
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'Escape') {
      setOpen(false)
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (hits.length === 0) return
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      setCursor(current => (current + step + hits.length) % hits.length)
      setOpen(true)
      return
    }
    if (event.key === 'Enter' && cursor >= 0 && hits[cursor]) {
      event.preventDefault()
      go(hits[cursor])
    }
  }

  const showPanel = open && isSearching
  const rowId = (hit: Hit) => `${listId}-${hit.key}`

  function renderGroup(title: string, group: Hit[], titleClass?: string) {
    if (group.length === 0) return null
    return (
      <li>
        <p
          className={cn(
            'px-3 pb-1 pt-2 text-[10px] font-medium uppercase tracking-widest text-slate-400',
            titleClass
          )}
        >
          {title}
        </p>
        <ul>
          {group.map(hit => {
            const index = hits.indexOf(hit)
            return (
              <li key={hit.key}>
                <button
                  type="button"
                  id={rowId(hit)}
                  role="option"
                  aria-selected={index === cursor}
                  // Keep focus in the input so typing continues to work; the
                  // cursor, not the DOM, tracks which row is live.
                  onMouseDown={event => event.preventDefault()}
                  onMouseEnter={() => setCursor(index)}
                  onClick={() => go(hit)}
                  className={cn(
                    'flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors',
                    index === cursor ? 'bg-brand-50' : 'hover:bg-slate-50'
                  )}
                >
                  <hit.Icon className="h-3.5 w-3.5 flex-shrink-0 text-slate-400" />
                  <span className="min-w-0 flex-1 truncate font-medium">{hit.label}</span>
                  <span className="flex-shrink-0 truncate text-[11px] text-slate-500">
                    {hit.detail}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </li>
    )
  }

  return (
    <div ref={rootRef} className={cn('relative min-w-0', className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input
        type="text"
        role="combobox"
        aria-label="Search repositories and people"
        aria-expanded={showPanel}
        aria-controls={showPanel ? listId : undefined}
        aria-activedescendant={cursor >= 0 && hits[cursor] ? rowId(hits[cursor]) : undefined}
        aria-autocomplete="list"
        placeholder="Search repositories and people"
        value={query}
        onChange={event => {
          setQuery(event.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-8 text-xs font-medium placeholder:font-normal placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
      />
      {query !== '' && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            setQuery('')
            setOpen(false)
          }}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 transition-colors hover:bg-slate-200/70 hover:text-slate-600"
        >
          <X className="h-3 w-3" />
        </button>
      )}

      {showPanel && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Search results"
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-72 overflow-y-auto rounded-xl border border-slate-200 bg-white pb-1 shadow-lg"
        >
          {renderGroup('Repositories', repoHits)}
          {renderGroup('People', personHits)}
          {suggestionHits.length > 0 && (
            <li aria-hidden className="mt-1 border-t border-slate-100 px-3 pt-2 text-xs text-slate-500">
              No matches for <span className="font-medium">“{query.trim()}”</span>
            </li>
          )}
          {renderGroup('Maybe you meant', suggestionHits, 'text-brand-500')}
          {hits.length === 0 && (
            <li className="px-3 py-3 text-xs text-slate-500">
              {peopleLoading ? 'Searching people…' : `No matches for “${query.trim()}”`}
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
