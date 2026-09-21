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

function settingsWith(criteria: string) {
  return {
    id: 's1',
    user_id: 'user-instructor-1',
    repo_root_directory: '/repos',
    llm_provider: 'anthropic',
    llm_model: 'claude-sonnet-5',
    anthropic_api_key_configured: false,
    ollama_base_url: null,
    health_thresholds: null,
    commit_evaluation_criteria: criteria,
  }
}

const rubricOf = (words: number) =>
  Array.from({ length: words }, (_, i) => `word${i + 1}`).join(' ')

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

// The rubric is re-sent with every summary and every batch of commits, so its
// length is a per-request cost multiplier. The character cap alone gives no
// useful feedback while writing prose, hence a visible word budget.
describe('SettingsPage rubric word limit', () => {
  it('counts the words in the persisted rubric against the limit', async () => {
    server.use(
      http.get('/api/v1/settings', () =>
        HttpResponse.json(settingsWith('Explain why, not just what.'))
      )
    )

    renderPage()

    expect(await screen.findByText('5/500 words')).toBeInTheDocument()
  })

  it('starts at zero for an empty rubric', async () => {
    renderPage()

    expect(await screen.findByText('0/500 words')).toBeInTheDocument()
  })

  it('counts words as you type, ignoring runs of whitespace', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.type(await criteriaBox(), '  one   two{Enter}three  ')

    expect(await screen.findByText('3/500 words')).toBeInTheDocument()
  })

  it('marks the count once the rubric runs past 500 words', async () => {
    server.use(
      http.get('/api/v1/settings', () => HttpResponse.json(settingsWith(rubricOf(501))))
    )

    renderPage()

    expect(await screen.findByText('501/500 words')).toHaveClass('text-destructive')
    expect(await screen.findByText(/500-word limit/i)).toBeInTheDocument()
  })

  it('does not block saving at exactly the limit', async () => {
    server.use(
      http.get('/api/v1/settings', () => HttpResponse.json(settingsWith(rubricOf(500))))
    )

    renderPage()

    await screen.findByText('500/500 words')
    expect(screen.getByRole('button', { name: /save settings/i })).toBeEnabled()
  })

  it('makes the disabled save button read as dead, not merely faded', async () => {
    server.use(
      http.get('/api/v1/settings', () => HttpResponse.json(settingsWith(rubricOf(501))))
    )

    renderPage()

    await screen.findByText('501/500 words')
    const save = screen.getByRole('button', { name: /save settings/i })
    // The shared Button only dims to 50% opacity when disabled, which on a
    // solid primary button still looks clickable. Over the limit it loses the
    // primary fill entirely and refuses the cursor.
    expect(save.className).toContain('disabled:bg-muted')
    expect(save.className).toContain('disabled:cursor-not-allowed')
    // The base variant's disabled:pointer-events-none would suppress that
    // cursor, so the merge has to drop it rather than keep both.
    expect(save.className).not.toContain('disabled:pointer-events-none')
    expect(save).toHaveAttribute('title', expect.stringMatching(/500-word limit/i))
  })

  it('will not save a rubric that is over the limit', async () => {
    let patched = false
    server.use(
      http.get('/api/v1/settings', () => HttpResponse.json(settingsWith(rubricOf(501)))),
      http.patch('/api/v1/settings', () => {
        patched = true
        return HttpResponse.json(settingsWith(rubricOf(501)))
      })
    )

    const user = userEvent.setup()
    renderPage()

    await screen.findByText('501/500 words')
    const save = screen.getByRole('button', { name: /save settings/i })
    expect(save).toBeDisabled()

    await user.click(save)

    expect(patched).toBe(false)
  })
})
