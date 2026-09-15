/**
 * Choosing what to be notified about, from inside the Active reminders panel.
 *
 * Subscriptions are per account: the professor and the TA each see and edit
 * their own map, which is why every assertion here goes through the API rather
 * than any shared module state.
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ActiveRemindersPanel } from '@/components/ActiveRemindersPanel'
import type { NotificationPreferences } from '@/types'

const getNotificationPreferences = vi.fn()
const updateNotificationPreferences = vi.fn()

vi.mock('@/services/api', () => ({
  getNotificationPreferences: (...a: unknown[]) => getNotificationPreferences(...a),
  updateNotificationPreferences: (...a: unknown[]) =>
    updateNotificationPreferences(...a),
  getReminders: () => Promise.resolve({ items: [], total: 0 }),
  getUsers: () => Promise.resolve([]),
  createNote: vi.fn(),
  deleteNote: vi.fn(),
  getRepo: vi.fn(),
  getRepoCommits: vi.fn(),
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'user-1', display_name: 'Prof Owner', role: 'instructor' as const },
    isAuthenticated: true,
    isLoading: false,
    login: () => Promise.resolve(),
    devLogin: () => Promise.resolve(),
    logout: () => {},
  }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}))

const ALL_ON: NotificationPreferences = {
  subscribed_events: {
    mention: true,
    note_comment: true,
    reminder: true,
    repo_added: true,
    repo_removed: true,
    repo_health_declined: true,
    pr_opened: true,
    pr_merged: true,
  },
}

function prefs(over: Partial<NotificationPreferences['subscribed_events']> = {}) {
  return { subscribed_events: { ...ALL_ON.subscribed_events, ...over } }
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

/** Open the disclosure and wait for the list to be there. */
async function openPreferences(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /notify me about/i }))
  return screen.findByTestId('notification-preferences')
}

beforeEach(() => {
  vi.clearAllMocks()
  getNotificationPreferences.mockResolvedValue(prefs())
  updateNotificationPreferences.mockImplementation((data) =>
    Promise.resolve(prefs(data.subscribed_events))
  )
})

describe('notification preferences in the reminders panel', () => {
  it('stays collapsed so the reminders list is what you see first', async () => {
    renderPanel()

    expect(await screen.findByText('Active reminders')).toBeInTheDocument()
    expect(screen.queryByTestId('notification-preferences')).not.toBeInTheDocument()
  })

  it('lists every event once expanded', async () => {
    const user = userEvent.setup()
    renderPanel()
    await openPreferences(user)

    expect(screen.getAllByRole('checkbox')).toHaveLength(8)
    expect(screen.getByRole('checkbox', { name: 'Mentions' })).toBeInTheDocument()
    expect(
      screen.getByRole('checkbox', { name: 'Reminders due' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('checkbox', { name: 'Pull request merged' })
    ).toBeInTheDocument()
  })

  it('reflects what the account already has saved', async () => {
    getNotificationPreferences.mockResolvedValue(prefs({ pr_opened: false }))
    const user = userEvent.setup()
    renderPanel()
    await openPreferences(user)

    expect(screen.getByRole('checkbox', { name: 'Pull request opened' })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Mentions' })).toBeChecked()
  })

  it('sends only the event that changed', async () => {
    const user = userEvent.setup()
    renderPanel()
    await openPreferences(user)

    await user.click(screen.getByRole('checkbox', { name: 'Pull request opened' }))

    await waitFor(() =>
      expect(updateNotificationPreferences).toHaveBeenCalledWith({
        subscribed_events: { pr_opened: false },
      })
    )
  })

  it('turns an event back on', async () => {
    getNotificationPreferences.mockResolvedValue(prefs({ mention: false }))
    const user = userEvent.setup()
    renderPanel()
    await openPreferences(user)

    await user.click(screen.getByRole('checkbox', { name: 'Mentions' }))

    await waitFor(() =>
      expect(updateNotificationPreferences).toHaveBeenCalledWith({
        subscribed_events: { mention: true },
      })
    )
  })

  it('shows the new state after saving', async () => {
    const user = userEvent.setup()
    renderPanel()
    await openPreferences(user)

    await user.click(screen.getByRole('checkbox', { name: 'Reminders due' }))

    await waitFor(() =>
      expect(screen.getByRole('checkbox', { name: 'Reminders due' })).not.toBeChecked()
    )
  })

  it('says how many events are muted without being expanded', async () => {
    getNotificationPreferences.mockResolvedValue(
      prefs({ pr_opened: false, repo_added: false })
    )
    renderPanel()

    expect(await screen.findByText('2 muted')).toBeInTheDocument()
  })

  it('says nothing about muting when everything is on', async () => {
    renderPanel()

    await screen.findByText('Active reminders')
    expect(screen.queryByText(/muted/)).not.toBeInTheDocument()
  })
})
