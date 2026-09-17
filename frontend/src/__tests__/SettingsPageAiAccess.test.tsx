/**
 * A non-administrator can no longer configure the AI model or hold a key.
 *
 * What replaces those controls matters as much as their removal: a user who
 * gets refused mid-task needs to be able to see the allowance that refused
 * them, or the 429 is a dead end.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { SettingsPage } from '@/pages/SettingsPage'

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'user-instructor-1', display_name: 'Mark', role: 'instructor' as const },
    isAuthenticated: true,
    isLoading: false,
    login: () => Promise.resolve(),
    logout: () => {},
  }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}))

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

function quota(overrides: Record<string, unknown>) {
  return {
    period: '2026-09',
    used: 0,
    limit: 500000,
    remaining: 500000,
    unlimited: false,
    exceeded: false,
    ...overrides,
  }
}

describe('SettingsPage no longer configures the LLM', () => {
  it('offers no API key field', async () => {
    renderPage()

    await screen.findByLabelText('Criteria')
    expect(screen.queryByLabelText(/api key/i)).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText(/sk-ant/i)).not.toBeInTheDocument()
  })

  it('offers no provider choice', async () => {
    renderPage()

    await screen.findByLabelText('Criteria')
    expect(
      screen.queryByRole('button', { name: /ollama/i })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /^anthropic$/i })
    ).not.toBeInTheDocument()
  })

  it('shows the instance model as read-only text, not a picker', async () => {
    renderPage()

    // Named so the user knows what will run, with no control to change it.
    expect(await screen.findByText('claude-sonnet-5')).toBeInTheDocument()
    expect(
      screen.queryByRole('combobox', { name: /model/i })
    ).not.toBeInTheDocument()
  })

  it('does not send LLM fields when saving', async () => {
    let patched: Record<string, unknown> | null = null
    server.use(
      http.patch('/api/v1/settings', async ({ request }) => {
        patched = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({
          id: 's1',
          user_id: 'user-instructor-1',
          repo_root_directory: '/repos',
          health_thresholds: null,
          commit_evaluation_criteria: '',
          llm_model: 'claude-sonnet-5',
        })
      })
    )

    const { default: userEvent } = await import('@testing-library/user-event')
    const user = userEvent.setup()
    renderPage()

    await screen.findByLabelText('Criteria')
    await user.click(screen.getByRole('button', { name: /save settings/i }))

    await waitFor(() => expect(patched).not.toBeNull())
    expect(Object.keys(patched ?? {})).not.toContain('anthropic_api_key')
    expect(Object.keys(patched ?? {})).not.toContain('llm_provider')
    expect(Object.keys(patched ?? {})).not.toContain('llm_model')
  })
})

describe('SettingsPage AI token usage', () => {
  it('shows what the user has spent against their allowance', async () => {
    server.use(
      http.get('/api/v1/settings/token-usage', () =>
        HttpResponse.json(quota({ used: 120000, remaining: 380000 }))
      )
    )

    renderPage()

    expect(await screen.findByText(/120,000/)).toBeInTheDocument()
    expect(await screen.findByText(/500,000/)).toBeInTheDocument()
  })

  it('says when the allowance is spent, and what to do about it', async () => {
    server.use(
      http.get('/api/v1/settings/token-usage', () =>
        HttpResponse.json(
          quota({ used: 500000, remaining: 0, exceeded: true })
        )
      )
    )

    renderPage()

    // The only route back is an administrator raising the limit, so the
    // message has to say so rather than just reporting the number.
    // Matched on the instruction, not on "administrator" alone — the card's
    // own description mentions administrators too.
    expect(
      await screen.findByText(/ask an administrator to raise your limit/i)
    ).toBeInTheDocument()
  })

  it('reports an admin as unmetered instead of showing a meter', async () => {
    server.use(
      http.get('/api/v1/settings/token-usage', () =>
        HttpResponse.json(
          quota({ used: 9000, limit: null, remaining: null, unlimited: true })
        )
      )
    )

    renderPage()

    expect(await screen.findByText(/not metered/i)).toBeInTheDocument()
  })
})
