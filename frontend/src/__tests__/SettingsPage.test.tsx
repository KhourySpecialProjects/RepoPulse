import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { SettingsPage } from '@/pages/SettingsPage'

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'user-instructor-1', display_name: 'Mark', role: 'admin' as const },
    isAuthenticated: true,
    isLoading: false,
    login: () => Promise.resolve(),
    devLogin: () => Promise.resolve(),
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

const criteriaBox = () => screen.findByLabelText('Criteria')

describe('SettingsPage commit evaluation criteria', () => {
  it('shows the persisted rubric', async () => {
    server.use(
      http.get('/api/v1/settings', () =>
        HttpResponse.json({
          id: 's1',
          user_id: 'user-instructor-1',
          repo_root_directory: '/repos',
          llm_provider: 'anthropic',
          llm_model: 'claude-sonnet-5',
          anthropic_api_key_configured: false,
          ollama_base_url: null,
          health_thresholds: null,
          commit_evaluation_criteria: 'Explain why, not just what.',
        })
      )
    )

    renderPage()

    await waitFor(async () =>
      expect(await criteriaBox()).toHaveValue('Explain why, not just what.')
    )
  })

  it('renders an empty box when no rubric is set', async () => {
    renderPage()

    expect(await criteriaBox()).toHaveValue('')
  })

  it('sends the rubric on save', async () => {
    let patched: Record<string, unknown> | null = null
    server.use(
      http.patch('/api/v1/settings', async ({ request }) => {
        patched = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({
          id: 's1',
          user_id: 'user-instructor-1',
          repo_root_directory: '/repos',
          llm_provider: 'anthropic',
          llm_model: 'claude-sonnet-5',
          anthropic_api_key_configured: false,
          ollama_base_url: null,
          health_thresholds: null,
          ...patched,
        })
      })
    )

    const user = userEvent.setup()
    renderPage()

    await user.type(await criteriaBox(), 'Be specific.')
    await user.click(screen.getByRole('button', { name: /save settings/i }))

    await waitFor(() =>
      expect(patched?.commit_evaluation_criteria).toBe('Be specific.')
    )
  })

  it('allows clearing the rubric', async () => {
    server.use(
      http.get('/api/v1/settings', () =>
        HttpResponse.json({
          id: 's1',
          user_id: 'user-instructor-1',
          repo_root_directory: '/repos',
          llm_provider: 'anthropic',
          llm_model: 'claude-sonnet-5',
          anthropic_api_key_configured: false,
          ollama_base_url: null,
          health_thresholds: null,
          commit_evaluation_criteria: 'Old rubric',
        })
      )
    )

    let patched: Record<string, unknown> | null = null
    server.use(
      http.patch('/api/v1/settings', async ({ request }) => {
        patched = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({ id: 's1', ...patched })
      })
    )

    const user = userEvent.setup()
    renderPage()

    await waitFor(async () => expect(await criteriaBox()).toHaveValue('Old rubric'))
    await user.clear(await criteriaBox())
    await user.click(screen.getByRole('button', { name: /save settings/i }))

    // Empty is a legitimate value — it means "use the built-in criteria alone"
    // — so it must be sent rather than blocked by the form.
    await waitFor(() => expect(patched?.commit_evaluation_criteria).toBe(''))
  })
})
