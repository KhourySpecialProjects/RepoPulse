/**
 * The commit filters of the repo page live in the query string, so a narrowed
 * view can be copied out of the address bar and handed to someone else.
 *
 * Fixture instants are six days apart so two commits are never the same local
 * day whatever timezone runs the suite, and expected date values are derived
 * with the page's own local-day rule rather than hardcoded.
 */
import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { RepoDetailPage } from '@/pages/RepoDetailPage'
import type { Commit, CommitType, Contributor, Repo } from '@/types'

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'user-test-1', display_name: 'Test User', role: 'instructor' as const },
    isAuthenticated: true,
    isLoading: false,
    login: () => Promise.resolve(),
    devLogin: () => Promise.resolve(),
    logout: () => {},
  }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}))

/** The page's own local-day rule, mirrored so assertions are timezone-agnostic. */
function localKey(iso: string): string {
  const d = new Date(iso)
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${month}-${day}`
}

const DAY_ONE = '2026-09-14T12:00:00Z'
const DAY_TWO = '2026-09-20T12:00:00Z'

const mockRepo: Repo = {
  id: 'repo-1',
  collection_id: 'col-1',
  github_url: 'https://github.com/student/project',
  name: 'student-project',
  local_path: '/repos/student-project',
  health_status: 'green',
  health_score: null,
  last_commit_at: DAY_TWO,
  last_synced_at: '2026-09-20T10:00:00Z',
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-20T10:00:00Z',
  contributor_count: 2,
  active_reminder_count: 0,
  expected_contributor_count: null,
  sync_status: 'idle',
  sync_started_at: null,
  sync_started_by_name: null,
  sync_error: null,
}

function contributor(id: string, name: string, email: string): Contributor {
  return {
    id,
    display_name: name,
    repo_id: 'repo-1',
    created_at: '2026-09-01T00:00:00Z',
    aliases: [{ id: `${id}-a`, git_email: email, git_name: name }],
    commit_count: 2,
    total_insertions: 10,
    total_deletions: 1,
    last_commit_at: DAY_TWO,
  }
}

// uuid4, as the backend issues. The URL carries only the first group of each.
const ALICE_ID = '550e8400-e29b-41d4-a716-446655440000'
const BOB_ID = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'
const ALICE_SHORT = '550e8400'
const BOB_SHORT = '6ba7b810'

// A third person on the roster, so selecting two is not the same as selecting
// everyone. No commits of their own — which is also what a contributor looks
// like right after their only work is merged into someone else.
const CHEN_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'

const ALICE = contributor(ALICE_ID, 'Alice Nguyen', 'alice@example.com')
const BOB = contributor(BOB_ID, 'Bob Ray', 'bob@example.com')
const CHEN = contributor(CHEN_ID, 'Chen Wei', 'chen@example.com')

function commit(
  hash: string,
  message: string,
  email: string,
  branch: string,
  date: string,
  commitType: CommitType | null
): Commit {
  return {
    hash,
    author_name: email === ALICE.aliases[0].git_email ? ALICE.display_name : BOB.display_name,
    author_email: email,
    date,
    message,
    branches: [branch],
    origin_branch: branch,
    insertions: 10,
    deletions: 1,
    files_changed: 2,
    commit_type: commitType,
    quality_score: null,
  }
}

// One commit per cell of the filter grid, so any single filter picks out a
// different subset and a combination of all four picks out exactly one row.
const COMMITS: Commit[] = [
  commit('aaa1111', 'alice on main', 'alice@example.com', 'main', DAY_ONE, 'substantive'),
  commit('bbb2222', 'bob on auth', 'bob@example.com', 'feature/auth', DAY_ONE, 'logistical'),
  commit('ccc3333', 'alice on auth', 'alice@example.com', 'feature/auth', DAY_TWO, null),
  commit('ddd4444', 'bob on docs', 'bob@example.com', 'docs', DAY_TWO, 'substantive'),
]

function setupHandlers(commits: Commit[] = COMMITS, delayCommits = false) {
  server.use(
    http.get('/api/v1/repos/:id', () => HttpResponse.json(mockRepo)),
    http.get('/api/v1/repos/:id/health', () => HttpResponse.json(null)),
    http.get('/api/v1/repos/:id/commits', async () => {
      if (delayCommits) await new Promise(resolve => setTimeout(resolve, 10_000))
      return HttpResponse.json({
        items: commits,
        total: commits.length,
        limit: 500,
        offset: 0,
      })
    }),
    http.get('/api/v1/repos/:id/contributors', () => HttpResponse.json([ALICE, BOB, CHEN])),
    http.get('/api/v1/repos/:id/summaries', () => HttpResponse.json([])),
    http.get('/api/v1/notes', () =>
      HttpResponse.json({ items: [], total: 0, limit: 50, offset: 0 })
    )
  )
}

/** MemoryRouter never touches window.location, so the URL is read from here. */
function LocationProbe() {
  const { search } = useLocation()
  return <span data-testid="search">{search}</span>
}

/**
 * Drives a real POP. The page's own back arrow is a push (see useBackTarget),
 * so it cannot show what the browser's Back button does to filter params.
 */
function BackProbe() {
  const navigate = useNavigate()
  return <button onClick={() => navigate(-1)}>probe-back</button>
}

function currentSearch(): string {
  const raw = screen.getByTestId('search').textContent ?? ''
  // Clearing the last filter leaves a bare '?', since setSearchParams always
  // navigates to '?' + params.
  return raw === '?' ? '' : raw
}

function renderAt(
  entries: Array<string | { pathname: string; search?: string; state?: unknown }>,
  initialIndex?: number
) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={entries} initialIndex={initialIndex}>
        <LocationProbe />
        <BackProbe />
        <Routes>
          <Route path="/repos/:id" element={<RepoDetailPage />} />
          <Route path="/collections" element={<p>collections list</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

function pressBrowserBack() {
  fireEvent.click(screen.getByRole('button', { name: 'probe-back' }))
}

function branchFilter() {
  return within(screen.getByRole('group', { name: 'Filter by commit branch' }))
}

function typeFilter() {
  return within(screen.getByRole('group', { name: 'Filter by commit type' }))
}

/** The commits card renders its pager above and below the table. */
async function goToCommitPage(label: string) {
  const pagers = await screen.findAllByRole('button', { name: label })
  fireEvent.click(pagers[0])
}

/** Waits for the commit table, which every assertion here depends on. */
async function waitForCommits() {
  await screen.findByRole('group', { name: 'Filter by commit branch' })
}

function visibleMessages(): string[] {
  return COMMITS.map(c => c.message).filter(m => screen.queryByText(m) !== null)
}

describe('RepoDetailPage — reading commit filters from the URL', () => {
  it('opens narrowed to the branch named in the URL', async () => {
    setupHandlers()
    renderAt(['/repos/repo-1?branch=feature%2Fauth'])
    await waitForCommits()

    await waitFor(() => expect(visibleMessages()).toEqual(['bob on auth', 'alice on auth']))
  })

  it('treats several branch params as one filter', async () => {
    setupHandlers()
    renderAt(['/repos/repo-1?branch=main&branch=docs'])
    await waitForCommits()

    await waitFor(() => expect(visibleMessages()).toEqual(['alice on main', 'bob on docs']))
  })

  it('opens narrowed to the commit type named in the URL', async () => {
    setupHandlers()
    renderAt(['/repos/repo-1?type=logistical'])
    await waitForCommits()

    await waitFor(() => expect(visibleMessages()).toEqual(['bob on auth']))
  })

  it('opens with the day named in the URL already chosen in the dropdown', async () => {
    setupHandlers()
    renderAt([`/repos/repo-1?date=${localKey(DAY_ONE)}`])
    await waitForCommits()

    await waitFor(() => expect(visibleMessages()).toEqual(['alice on main', 'bob on auth']))
    expect(screen.getByLabelText('Filter commits by date')).toHaveValue(localKey(DAY_ONE))
  })

  it('opens narrowed to the people named in the URL', async () => {
    setupHandlers()
    renderAt([`/repos/repo-1?contributor=${BOB_SHORT}`])
    await waitForCommits()

    await waitFor(() => expect(visibleMessages()).toEqual(['bob on auth', 'bob on docs']))
    expect(screen.getByRole('checkbox', { name: 'Select Bob Ray' })).toBeChecked()
  })

  it('opens with everyone selected for the everyone sentinel', async () => {
    setupHandlers()
    renderAt(['/repos/repo-1?contributor=all'])
    await waitForCommits()

    await waitFor(() => expect(visibleMessages()).toHaveLength(COMMITS.length))
    expect(screen.getByRole('checkbox', { name: 'Select all contributors' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Select Chen Wei' })).toBeChecked()
  })

  it('applies all four filters at once', async () => {
    setupHandlers()
    renderAt([
      `/repos/repo-1?branch=feature%2Fauth&type=logistical&date=${localKey(DAY_ONE)}&contributor=${BOB_SHORT}`,
    ])
    await waitForCommits()

    await waitFor(() => expect(visibleMessages()).toEqual(['bob on auth']))
  })

  it('shows every commit when no filter param is present', async () => {
    setupHandlers()
    renderAt(['/repos/repo-1'])
    await waitForCommits()

    await waitFor(() => expect(visibleMessages()).toHaveLength(COMMITS.length))
  })
})

describe('RepoDetailPage — writing commit filters to the URL', () => {
  it('records a branch chip in the URL as it is clicked', async () => {
    setupHandlers()
    renderAt(['/repos/repo-1'])
    await waitForCommits()

    fireEvent.click(branchFilter().getByRole('button', { name: 'feature/auth' }))

    // A slash has to survive the round trip, so the value is escaped.
    await waitFor(() => expect(currentSearch()).toBe('?branch=feature%2Fauth'))
    expect(visibleMessages()).toEqual(['bob on auth', 'alice on auth'])
  })

  it('records a branch chip clicked from inside a commit row', async () => {
    setupHandlers()
    renderAt(['/repos/repo-1'])
    await waitForCommits()

    // The row's own chip is the same filter, and is outside the filter panel.
    const rowChips = screen.getAllByRole('button', { name: 'docs' })
    fireEvent.click(rowChips[rowChips.length - 1])

    await waitFor(() => expect(currentSearch()).toBe('?branch=docs'))
  })

  it('drops the branch param when All is clicked', async () => {
    setupHandlers()
    renderAt(['/repos/repo-1?branch=docs'])
    await waitForCommits()

    fireEvent.click(branchFilter().getByRole('button', { name: 'All' }))

    await waitFor(() => expect(currentSearch()).toBe(''))
    expect(visibleMessages()).toHaveLength(COMMITS.length)
  })

  it('records two selected types as two type params', async () => {
    setupHandlers()
    renderAt(['/repos/repo-1'])
    await waitForCommits()

    fireEvent.click(typeFilter().getByRole('button', { name: 'Unclassified' }))
    fireEvent.click(typeFilter().getByRole('button', { name: 'Substantive' }))

    await waitFor(() => expect(currentSearch()).toBe('?type=substantive&type=unclassified'))
  })

  it('records the chosen day in the URL', async () => {
    setupHandlers()
    renderAt(['/repos/repo-1'])
    await waitForCommits()

    fireEvent.change(screen.getByLabelText('Filter commits by date'), {
      target: { value: localKey(DAY_TWO) },
    })

    await waitFor(() => expect(currentSearch()).toBe(`?date=${localKey(DAY_TWO)}`))
  })

  it('joins the selected contributors into one key', async () => {
    setupHandlers()
    renderAt(['/repos/repo-1'])
    await waitForCommits()

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Bob Ray' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Alice Nguyen' }))

    // One key, short ids, joined with a dot — a full uuid apiece under its own
    // key came to 49 characters per person.
    await waitFor(() =>
      expect(currentSearch()).toBe(`?contributor=${ALICE_SHORT}.${BOB_SHORT}`)
    )
  })

  it('collapses Select all to one word instead of the whole roster', async () => {
    // Everyone selected shows the same commits as nobody selected, so naming
    // each person says nothing and is the longest the key can get.
    setupHandlers()
    renderAt(['/repos/repo-1'])
    await waitForCommits()

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all contributors' }))

    await waitFor(() => expect(currentSearch()).toBe('?contributor=all'))
    // Still a real selection, though: it is what Merge acts on.
    expect(screen.getByRole('checkbox', { name: 'Select Alice Nguyen' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Select all contributors' })).toBeChecked()
    expect(visibleMessages()).toHaveLength(COMMITS.length)
  })

  it('names the people again as soon as the selection is not everyone', async () => {
    setupHandlers()
    renderAt(['/repos/repo-1?contributor=all'])
    await waitForCommits()

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Chen Wei' }))

    await waitFor(() =>
      expect(currentSearch()).toBe(`?contributor=${ALICE_SHORT}.${BOB_SHORT}`)
    )
  })

  it('keeps all four filters in one URL', async () => {
    setupHandlers()
    renderAt(['/repos/repo-1'])
    await waitForCommits()

    fireEvent.click(branchFilter().getByRole('button', { name: 'feature/auth' }))
    fireEvent.click(typeFilter().getByRole('button', { name: 'Logistical' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Bob Ray' }))
    fireEvent.change(screen.getByLabelText('Filter commits by date'), {
      target: { value: localKey(DAY_ONE) },
    })

    await waitFor(() =>
      expect(currentSearch()).toBe(
        `?branch=feature%2Fauth&type=logistical&date=${localKey(DAY_ONE)}&contributor=${BOB_SHORT}`
      )
    )
    expect(visibleMessages()).toEqual(['bob on auth'])
  })

  it('carries an unrelated query param through a filter write', async () => {
    setupHandlers()
    renderAt(['/repos/repo-1?ref=email'])
    await waitForCommits()

    fireEvent.click(branchFilter().getByRole('button', { name: 'main' }))

    await waitFor(() => expect(currentSearch()).toBe('?ref=email&branch=main'))
  })
})

describe('RepoDetailPage — filter params that no longer resolve', () => {
  it('ignores a branch the repo no longer has', async () => {
    setupHandlers()
    renderAt(['/repos/repo-1?branch=deleted'])
    await waitForCommits()

    // An empty table with no chip lit would leave the reader with nothing to
    // undo, so an unrecognised value is simply not a filter.
    await waitFor(() => expect(visibleMessages()).toHaveLength(COMMITS.length))
    expect(branchFilter().getByRole('button', { name: 'All' })).toHaveClass('bg-brand-600')
  })

  it('ignores a contributor id the repo does not have', async () => {
    setupHandlers()
    renderAt(['/repos/repo-1?contributor=99999999'])
    await waitForCommits()

    await waitFor(() => expect(visibleMessages()).toHaveLength(COMMITS.length))
  })

  it('ignores a day the repo has no commits on', async () => {
    setupHandlers()
    renderAt(['/repos/repo-1?date=1999-01-01'])
    await waitForCommits()

    await waitFor(() => expect(visibleMessages()).toHaveLength(COMMITS.length))
    expect(screen.getByLabelText('Filter commits by date')).toHaveValue('')
  })

  it('still resolves a full uuid, as workspace search links carry one', async () => {
    setupHandlers()
    renderAt([`/repos/repo-1?contributor=${BOB_ID}`])
    await waitForCommits()

    await waitFor(() => expect(visibleMessages()).toEqual(['bob on auth', 'bob on docs']))
  })

  it('ignores a type value that is not a commit type', async () => {
    setupHandlers()
    renderAt(['/repos/repo-1?type=bogus'])
    await waitForCommits()

    await waitFor(() => expect(visibleMessages()).toHaveLength(COMMITS.length))
  })

  it('keeps the branch that does resolve alongside one that does not', async () => {
    setupHandlers()
    renderAt(['/repos/repo-1?branch=docs&branch=deleted'])
    await waitForCommits()

    await waitFor(() => expect(visibleMessages()).toEqual(['bob on docs']))
  })

  it('leaves the params alone while the commit list is still loading', async () => {
    // Before the commits land there is no way to tell a rotted value from a
    // good one, so the URL is trusted rather than edited.
    setupHandlers(COMMITS, true)
    renderAt(['/repos/repo-1?branch=deleted'])

    await screen.findByText('student-project')
    expect(currentSearch()).toBe('?branch=deleted')
  })

  it('drops the value it ignored once any filter is touched', async () => {
    setupHandlers()
    renderAt(['/repos/repo-1?branch=deleted'])
    await waitForCommits()

    fireEvent.click(branchFilter().getByRole('button', { name: 'docs' }))

    await waitFor(() => expect(currentSearch()).toBe('?branch=docs'))
  })
})

describe('RepoDetailPage — filter params and history', () => {
  it('leaves the page on one Back press after several filter changes', async () => {
    setupHandlers()
    renderAt(['/collections', '/repos/repo-1'], 1)
    await waitForCommits()

    fireEvent.click(branchFilter().getByRole('button', { name: 'main' }))
    await waitFor(() => expect(currentSearch()).toBe('?branch=main'))
    fireEvent.click(typeFilter().getByRole('button', { name: 'Substantive' }))
    await waitFor(() => expect(currentSearch()).toContain('type=substantive'))

    // Each write replaces, so the filtered states are not history entries and
    // one press is enough to get back out.
    pressBrowserBack()

    expect(await screen.findByText('collections list')).toBeInTheDocument()
  })

  it('keeps the recorded origin so the back arrow still names it', async () => {
    // setSearchParams goes through navigate(), which drops location.state
    // unless it is passed back in — and that state is the back arrow's label.
    setupHandlers()
    renderAt([{ pathname: '/repos/repo-1', state: { from: '/' } }])
    await waitForCommits()

    expect(screen.getByLabelText('Back to dashboard')).toBeInTheDocument()
    fireEvent.click(branchFilter().getByRole('button', { name: 'main' }))

    await waitFor(() => expect(currentSearch()).toBe('?branch=main'))
    expect(screen.getByLabelText('Back to dashboard')).toBeInTheDocument()
  })

  it('shows the filters again when the browser goes back to a filtered URL', async () => {
    setupHandlers()
    renderAt(['/repos/repo-1?branch=docs', '/repos/repo-1'], 1)
    await waitForCommits()

    await waitFor(() => expect(visibleMessages()).toHaveLength(COMMITS.length))
    pressBrowserBack()

    await waitFor(() => expect(visibleMessages()).toEqual(['bob on docs']))
  })
})

describe('RepoDetailPage — filter params alongside a deep link', () => {
  it('clears the commit deep link but keeps the filters', async () => {
    setupHandlers()
    renderAt(['/repos/repo-1?commit=ccc3333&branch=feature%2Fauth'])
    await waitForCommits()

    await waitFor(() => expect(currentSearch()).toBe('?branch=feature%2Fauth'))
    expect(screen.getByText('alice on auth')).toBeInTheDocument()
    expect(screen.queryByText('alice on main')).not.toBeInTheDocument()
  })

  it('keeps the filters while the note deep link is consumed', async () => {
    setupHandlers()
    renderAt(['/repos/repo-1?note=n-1&branch=docs'])
    await waitForCommits()

    await waitFor(() => expect(currentSearch()).toBe('?branch=docs'))
  })
})

/**
 * Pagination is deliberately *not* in the URL, so it is local state that a
 * filter change can leave stranded past the end of the results.
 */
describe('RepoDetailPage — pagination against URL filters', () => {
  const MANY: Commit[] = [
    ...Array.from({ length: 25 }, (_, i) =>
      commit(
        `main${String(i).padStart(4, '0')}`,
        `main commit ${i}`,
        'alice@example.com',
        'main',
        DAY_ONE,
        'substantive'
      )
    ),
    commit('doc00001', 'the only docs commit', 'bob@example.com', 'docs', DAY_TWO, null),
  ]

  it('falls back to the first page when a Back press leaves it out of range', async () => {
    setupHandlers(MANY)
    renderAt(['/repos/repo-1?branch=docs', '/repos/repo-1?branch=main'], 1)
    await waitForCommits()

    await goToCommitPage('3')
    expect(await screen.findByText('main commit 20')).toBeInTheDocument()

    pressBrowserBack()

    expect(await screen.findByText('the only docs commit')).toBeInTheDocument()
  })

  // A commit's page number comes from its position in the *filtered* list,
  // which is the list the table pages over.
  it('jumps to the right page for a commit deep link while a filter narrows the list', async () => {
    const TWO_BRANCHES: Commit[] = [
      ...Array.from({ length: 25 }, (_, i) =>
        commit(`main${String(i).padStart(4, '0')}`, `main commit ${i}`, 'alice@example.com', 'main', DAY_ONE, 'substantive')
      ),
      ...Array.from({ length: 25 }, (_, i) =>
        commit(`docs${String(i).padStart(4, '0')}`, `docs commit ${i}`, 'bob@example.com', 'docs', DAY_TWO, null)
      ),
    ]
    setupHandlers(TWO_BRANCHES)
    // Filtered index 20 is page 3; its index in the unfiltered list is 45,
    // which would name a page the filtered list does not even have.
    renderAt(['/repos/repo-1?branch=docs&commit=docs0020'])
    await waitForCommits()

    expect(await screen.findByText('docs commit 20')).toBeInTheDocument()
    await waitFor(() => expect(currentSearch()).toBe('?branch=docs'))
  })

  it('returns to the first page when a filter is applied from a later page', async () => {
    setupHandlers(MANY)
    renderAt(['/repos/repo-1'])
    await waitForCommits()

    await goToCommitPage('3')
    expect(await screen.findByText('main commit 20')).toBeInTheDocument()

    fireEvent.click(branchFilter().getByRole('button', { name: 'docs' }))

    expect(await screen.findByText('the only docs commit')).toBeInTheDocument()
  })
})
