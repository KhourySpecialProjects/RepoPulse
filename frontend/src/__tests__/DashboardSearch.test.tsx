import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { DashboardSearch } from '@/components/dashboard/DashboardSearch'
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

const repos = [repo('capstone-api', 'r-api'), repo('capstone-web', 'r-web')]
const people: PersonEntry[] = [
  { id: 'c-alice', name: 'Alice Nguyen', repoId: 'r-api', repoName: 'capstone-api' },
]

/** Shows where a result sent the browser, including the query string. */
function Landed() {
  const location = useLocation()
  return <div data-testid="landed">{`${location.pathname}${location.search}`}</div>
}

const onPeopleNeeded = vi.fn()
beforeEach(() => onPeopleNeeded.mockClear())

function renderSearch(props: Partial<React.ComponentProps<typeof DashboardSearch>> = {}) {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route
          path="/"
          element={
            <DashboardSearch
              repos={repos}
              people={people}
              onPeopleNeeded={onPeopleNeeded}
              {...props}
            />
          }
        />
        <Route path="/repos/:id" element={<Landed />} />
      </Routes>
    </MemoryRouter>
  )
}

const box = () => screen.getByRole('combobox', { name: 'Search repositories and people' })

describe('DashboardSearch', () => {
  it('shows nothing until the query is long enough to be a search', async () => {
    renderSearch()

    await userEvent.type(box(), 'c')

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('groups matching repositories and people', async () => {
    renderSearch()

    await userEvent.type(box(), 'capstone')

    const results = screen.getByRole('listbox')
    expect(within(results).getByText('capstone-api')).toBeInTheDocument()
    expect(within(results).getByText('capstone-web')).toBeInTheDocument()
    expect(within(results).getByText('Repositories')).toBeInTheDocument()
  })

  it('says which repository a person belongs to', async () => {
    renderSearch()

    await userEvent.type(box(), 'alice')

    const results = screen.getByRole('listbox')
    expect(within(results).getByText('Alice Nguyen')).toBeInTheDocument()
    expect(within(results).getByText(/capstone-api/)).toBeInTheDocument()
    expect(within(results).getByText('People')).toBeInTheDocument()
  })

  it('opens the repository a result points at', async () => {
    renderSearch()

    await userEvent.type(box(), 'capstone-web')
    await userEvent.click(screen.getByRole('option', { name: /capstone-web/ }))

    expect(screen.getByTestId('landed')).toHaveTextContent('/repos/r-web')
  })

  // Landing on a repo page with no hint of why is a dead end, so the person
  // arrives selected.
  it('opens a person on their repository with that person selected', async () => {
    renderSearch()

    await userEvent.type(box(), 'alice')
    await userEvent.click(screen.getByRole('option', { name: /Alice Nguyen/ }))

    expect(screen.getByTestId('landed')).toHaveTextContent('/repos/r-api?contributor=c-alice')
  })

  it('walks the results with the arrow keys and opens with Enter', async () => {
    renderSearch()

    await userEvent.type(box(), 'capstone')
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}')

    expect(screen.getByTestId('landed')).toHaveTextContent('/repos/r-web')
  })

  it('marks the highlighted row for assistive tech', async () => {
    renderSearch()

    await userEvent.type(box(), 'capstone')
    await userEvent.keyboard('{ArrowDown}')

    const active = screen.getByRole('option', { selected: true })
    expect(active).toHaveTextContent('capstone-api')
    expect(box()).toHaveAttribute('aria-activedescendant', active.id)
  })

  it('closes on Escape without navigating', async () => {
    renderSearch()

    await userEvent.type(box(), 'capstone')
    await userEvent.keyboard('{Escape}')

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(screen.queryByTestId('landed')).not.toBeInTheDocument()
  })

  it('says so when nothing matches and nothing is even close', async () => {
    renderSearch()

    await userEvent.type(box(), 'zzzzzz')

    const results = screen.getByRole('listbox')
    expect(results).toHaveTextContent(/No matches/i)
    expect(results).not.toHaveTextContent(/Maybe you meant/i)
  })

  it('offers near-misses under "Maybe you meant" for a typo', async () => {
    renderSearch()

    await userEvent.type(box(), 'capstoen')

    const results = screen.getByRole('listbox')
    expect(results).toHaveTextContent(/Maybe you meant/i)
    expect(within(results).getByText('capstone-api')).toBeInTheDocument()
    // It is a fallback, not a result — the promise of a match would be a lie.
    expect(results).not.toHaveTextContent(/^Repositories/)
  })

  it('suggests a person whose name was misspelled', async () => {
    renderSearch()

    await userEvent.type(box(), 'Alcie')

    const results = screen.getByRole('listbox')
    expect(results).toHaveTextContent(/Maybe you meant/i)
    expect(within(results).getByText('Alice Nguyen')).toBeInTheDocument()
  })

  it('opens a suggestion the same way it opens a result', async () => {
    renderSearch()

    await userEvent.type(box(), 'capstoen')
    await userEvent.click(screen.getByRole('option', { name: /capstone-api/ }))

    expect(screen.getByTestId('landed')).toHaveTextContent('/repos/r-api')
  })

  it('lets the arrow keys reach a suggestion', async () => {
    renderSearch()

    await userEvent.type(box(), 'capstoen')
    await userEvent.keyboard('{ArrowDown}{Enter}')

    expect(screen.getByTestId('landed')).toHaveTextContent('/repos/r-api')
  })

  it('shows no suggestion block when the query matched exactly', async () => {
    renderSearch()

    await userEvent.type(box(), 'capstone')

    expect(screen.getByRole('listbox')).not.toHaveTextContent(/Maybe you meant/i)
  })

  // Contributors cost a request per collection, so they are only fetched once
  // someone is actually searching.
  it('asks for people only when a real query is typed', async () => {
    renderSearch()

    expect(onPeopleNeeded).not.toHaveBeenCalled()

    await userEvent.type(box(), 'ca')

    expect(onPeopleNeeded).toHaveBeenCalled()
  })

  it('reports that people are still loading rather than claiming no matches', async () => {
    renderSearch({ people: [], peopleLoading: true })

    await userEvent.type(box(), 'alice')

    expect(screen.getByRole('listbox')).toHaveTextContent(/searching people/i)
  })
})
