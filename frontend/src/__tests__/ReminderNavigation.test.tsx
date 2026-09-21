/**
 * Clicking a reminder has to land you where you left it.
 *
 * A reminder pinned to a commit carries `commit_hash`, and the repo page can
 * already scroll to a commit — it just had no way to be asked to on arrival.
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ActiveRemindersPanel } from '@/components/ActiveRemindersPanel'
import { reminderTarget } from '@/lib/reminders'
import type { Reminder } from '@/types'

const navigate = vi.hoisted(() => vi.fn())
vi.mock('react-router-dom', async () => ({
  ...(await vi.importActual<typeof import('react-router-dom')>('react-router-dom')),
  useNavigate: () => navigate,
}))

const getReminders = vi.fn()
const getRepo = vi.fn()
const getRepoCommits = vi.fn()

vi.mock('@/services/api', () => ({
  // The reminders panel reads the signed-in user's subscriptions.
  getNotificationPreferences: () => Promise.resolve({ subscribed_events: {} }),
  updateNotificationPreferences: vi.fn(),
  getReminders: (...a: unknown[]) => getReminders(...a),
  getRepo: (...a: unknown[]) => getRepo(...a),
  getRepoCommits: (...a: unknown[]) => getRepoCommits(...a),
  getUsers: () => Promise.resolve([]),
  createNote: vi.fn(),
  deleteNote: vi.fn(),
  getRepos: vi.fn(),
  addRepos: vi.fn(),
  syncRepo: vi.fn(),
  deleteRepo: vi.fn(),
  getRepoHealth: vi.fn(),
  getRepoContributors: vi.fn(),
  updateContributor: vi.fn(),
  mergeContributors: vi.fn(),
  unmergeContributor: vi.fn(),
  patchRepo: vi.fn(),
  getPullRequests: vi.fn(),
  getPRStats: vi.fn(),
  syncPullRequests: vi.fn(),
  classifyRepoCommits: vi.fn(),
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1', role: 'instructor' }, isAuthenticated: true }),
}))

function reminder(over: Partial<Reminder> = {}): Reminder {
  return {
    id: 'rem-1',
    content: 'Check the merge conflict resolution',
    remind_at: '2099-01-01T10:00:00Z',
    reminder_context: null,
    repo_id: 'repo-1',
    commit_hash: 'abc1234def5678',
    created_at: '2026-09-01T10:00:00Z',
    owner_display_name: 'Prof Owner',
    shared_with: [],
    is_owner: true,
    ...over,
  }
}

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ActiveRemindersPanel />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  getRepo.mockResolvedValue({ id: 'repo-1', name: 'team-4' })
  getRepoCommits.mockResolvedValue({ items: [], total: 0, limit: 500, offset: 0 })
})

describe('clicking a reminder', () => {
  it('opens the commit the reminder was placed on', async () => {
    getReminders.mockResolvedValue({ items: [reminder()], total: 1 })
    renderPanel()

    await userEvent.click(
      await screen.findByRole('button', {
        name: /Check the merge conflict resolution/,
      })
    )

    expect(navigate).toHaveBeenCalledWith('/repos/repo-1?commit=abc1234def5678')
  })

  it('opens the repo when the reminder is not tied to a commit', async () => {
    getReminders.mockResolvedValue({
      items: [reminder({ commit_hash: null })],
      total: 1,
    })
    renderPanel()

    await userEvent.click(
      await screen.findByRole('button', {
        name: /Check the merge conflict resolution/,
      })
    )

    expect(navigate).toHaveBeenCalledWith('/repos/repo-1')
  })

  it('shows the commit hash on the row so the target is visible', async () => {
    getReminders.mockResolvedValue({ items: [reminder()], total: 1 })
    renderPanel()

    expect(await screen.findByText('abc1234')).toBeInTheDocument()
  })

  it('leaves a standalone reminder non-clickable', async () => {
    getReminders.mockResolvedValue({
      items: [reminder({ repo_id: null, commit_hash: null, content: 'Buy coffee' })],
      total: 1,
    })
    renderPanel()

    await screen.findByText('Buy coffee')
    // Only the delete control is a button on this row.
    expect(
      screen.queryByRole('button', { name: /Buy coffee/ })
    ).not.toBeInTheDocument()
  })

  it('prefetches the repo and its commits on hover, before any click', async () => {
    getReminders.mockResolvedValue({ items: [reminder()], total: 1 })
    renderPanel()

    await userEvent.hover(
      await screen.findByRole('button', {
        name: /Check the merge conflict resolution/,
      })
    )

    // The commit list is what the jump blocks on, so it must be warmed too.
    await waitFor(() => expect(getRepo).toHaveBeenCalledWith('repo-1'))
    await waitFor(() =>
      expect(getRepoCommits).toHaveBeenCalledWith('repo-1', { limit: 500, offset: 0 })
    )
    expect(navigate).not.toHaveBeenCalled()
  })

  it('still lets the owner delete without navigating', async () => {
    getReminders.mockResolvedValue({ items: [reminder()], total: 1 })
    renderPanel()

    await userEvent.click(
      await screen.findByRole('button', { name: 'Remove reminder' })
    )

    expect(navigate).not.toHaveBeenCalled()
  })
})

describe('reminderTarget', () => {
  it('deep links to a commit when there is one', () => {
    expect(reminderTarget({ repo_id: 'r1', commit_hash: 'deadbeef' })).toBe(
      '/repos/r1?commit=deadbeef'
    )
  })

  it('falls back to the repo', () => {
    expect(reminderTarget({ repo_id: 'r1', commit_hash: null })).toBe('/repos/r1')
  })

  it('has nowhere to go without a repo', () => {
    expect(reminderTarget({ repo_id: null, commit_hash: 'deadbeef' })).toBeNull()
  })
})
